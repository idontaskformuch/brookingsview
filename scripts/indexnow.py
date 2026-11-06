"""IndexNow after a successful deploy: ping only the sitemap URLs whose built HTML changed (owner 2026-11-03).

How it works (no extra storage): every deploy ships `indexnow-manifest.json` (URL -> content hash for every sitemap URL).
  prepare (BEFORE `wrangler deploy`): fetch the manifest that is live now (= the previous deploy), hash the fresh dist/,
      write the new manifest into dist/ (so it goes live with this deploy) and the changed/new URLs to a pending file.
  ping (AFTER a successful deploy): ONE POST per domain to api.indexnow.org with the pending URLs; logs count and status.
Unchanged pages are never pinged. No live manifest (first deploy, fetch error) = baseline only: nothing is pinged, so a
broken fetch can never turn into a mass ping. Only URLs listed in the sitemap are considered, so noindex pages (which
are filtered out of the sitemap) are never submitted. Nothing here can fail a deploy: the shell wrapper ignores the exit code.

The hash covers the visible HTML only: <script>, <style>, comments and whitespace are stripped, so a new build id or
hashed asset name or the build-sha / data-built-at metas alone do not count as a change.

Usage (from the repo root; wrangler_deploy_retry.sh does this):
    python -m scripts.indexnow prepare --env glasgow [--dist site/dist]
    python -m scripts.indexnow ping --env glasgow
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from pathlib import Path
from urllib.parse import urlparse

import requests

ROOT = Path(__file__).resolve().parent.parent
# The IndexNow key is public by design (served at /<key>.txt on all four domains); read it from that file instead of
# repeating it in code, so there is one source and no secret-scanner noise.
_KEY_FILES = sorted(p for p in (ROOT / "site" / "public").glob("*.txt") if re.fullmatch(r"[0-9a-f]{32}", p.stem))
KEY = _KEY_FILES[0].stem if _KEY_FILES else ""
ENDPOINT = "https://api.indexnow.org/IndexNow"
MANIFEST_NAME = "indexnow-manifest.json"
PENDING_NAME = "indexnow-pending.json"
BATCH = 10000  # IndexNow's per-request limit

# wrangler --env name -> site (wrangler.jsonc env names)
SITES = {
    "brookings": "https://brookingsview.com",
    "moreno_valley": "https://morenovalleyview.com",
    "broomfield": "https://broomfieldview.com",
    "glasgow": "https://glasgowloop.co.uk",
}

_STRIP = [re.compile(p, re.I | re.S) for p in (r"<script\b.*?</script>", r"<style\b.*?</style>", r"<!--.*?-->", r"<meta name=\"build-sha\"[^>]*>", r"<meta name=\"data-built-at\"[^>]*>")]


def content_hash(html: str) -> str:
    for rx in _STRIP:
        html = rx.sub("", html)
    html = re.sub(r"\s+", " ", html).strip()
    return hashlib.sha256(html.encode("utf-8")).hexdigest()[:16]


def sitemap_urls(dist: Path) -> list[str]:
    """Every <loc> in the built sitemap files (index -> children)."""
    index = dist / "sitemap-index.xml"
    if not index.exists():
        return []
    files = [dist / Path(urlparse(u).path).name for u in re.findall(r"<loc>([^<]+)</loc>", index.read_text(encoding="utf-8"))]
    urls: list[str] = []
    for f in files:
        if f.exists():
            urls += re.findall(r"<loc>([^<]+)</loc>", f.read_text(encoding="utf-8"))
    return urls


def page_file(dist: Path, url: str) -> Path:
    path = urlparse(url).path
    return dist / path.lstrip("/") / "index.html" if path.endswith("/") else dist / path.lstrip("/")


def build_manifest(dist: Path, host: str) -> dict[str, str]:
    manifest: dict[str, str] = {}
    for url in sitemap_urls(dist):
        if urlparse(url).netloc != host:
            continue  # IndexNow only accepts URLs on the host it is posted for
        f = page_file(dist, url)
        if f.is_file():
            manifest[url] = content_hash(f.read_text(encoding="utf-8", errors="replace"))
    return manifest


def changed_urls(new: dict[str, str], old: dict[str, str] | None) -> list[str]:
    """New or changed URLs. No baseline (None) = nothing to ping."""
    if old is None:
        return []
    return sorted(u for u, h in new.items() if old.get(u) != h)


def fetch_live_manifest(site: str) -> dict[str, str] | None:
    try:
        r = requests.get(f"{site}/{MANIFEST_NAME}", timeout=20, headers={"Cache-Control": "no-cache"})
        if r.status_code != 200:
            return None
        data = r.json()
        return data if isinstance(data, dict) and data else None
    except (requests.RequestException, ValueError):
        return None


def post_batches(site: str, urls: list[str], post=requests.post) -> list[int]:
    host = urlparse(site).netloc
    codes = []
    for i in range(0, len(urls), BATCH):
        body = {"host": host, "key": KEY, "keyLocation": f"{site}/{KEY}.txt", "urlList": urls[i:i + BATCH]}
        r = post(ENDPOINT, json=body, headers={"Content-Type": "application/json; charset=utf-8"}, timeout=30)
        codes.append(r.status_code)
    return codes


def log(msg: str) -> None:
    print(msg)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as fh:
            fh.write(msg + "\n\n")


def cmd_prepare(env: str, dist: Path) -> int:
    site = SITES[env]
    host = urlparse(site).netloc
    new = build_manifest(dist, host)
    if not new:
        log(f"[indexnow] {env}: no sitemap URLs found in {dist}, nothing to do")
        return 0
    old = fetch_live_manifest(site)
    urls = changed_urls(new, old)
    (dist / MANIFEST_NAME).write_text(json.dumps(new, indent=0, sort_keys=True), encoding="utf-8")
    (dist.parent / PENDING_NAME).write_text(json.dumps({"env": env, "urls": urls}), encoding="utf-8")
    if old is None:
        log(f"[indexnow] {env}: no live manifest, baseline of {len(new)} URLs written, nothing will be pinged")
    else:
        log(f"[indexnow] {env}: {len(urls)} of {len(new)} sitemap URLs changed or new since the previous deploy")
    return 0


def cmd_ping(env: str, dist: Path) -> int:
    pending = dist.parent / PENDING_NAME
    if not pending.exists():
        log(f"[indexnow] {env}: no pending file, nothing pinged")
        return 0
    data = json.loads(pending.read_text(encoding="utf-8"))
    pending.unlink()
    if data.get("env") != env:
        log(f"[indexnow] {env}: pending file belongs to {data.get('env')}, ignored")
        return 0
    urls = data.get("urls", [])
    if not urls:
        log(f"[indexnow] {env}: 0 changed URLs, no ping")
        return 0
    codes = post_batches(SITES[env], urls)
    ok = all(c in (200, 202) for c in codes)
    log(f"[indexnow] {env}: pinged {len(urls)} URLs in {len(codes)} call(s) to api.indexnow.org, HTTP {', '.join(map(str, codes))}"
        + ("" if ok else " (NOT accepted)"))
    return 0 if ok else 1


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("action", choices=["prepare", "ping"])
    ap.add_argument("--env", required=True)
    ap.add_argument("--dist", default=str(ROOT / "site" / "dist"))
    a = ap.parse_args(argv)
    if a.env not in SITES:
        print(f"[indexnow] unknown env {a.env!r}, skipped")
        return 0
    dist = Path(a.dist)
    try:
        return (cmd_prepare if a.action == "prepare" else cmd_ping)(a.env, dist)
    except Exception as exc:  # noqa: BLE001 -- never block a deploy
        print(f"[indexnow] {a.env} {a.action} failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
