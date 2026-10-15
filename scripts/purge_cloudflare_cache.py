"""Post-deploy Cloudflare cache purge.

Root cause (2026-10-15 incident, see .claude/state.md): Cloudflare
Workers Static Assets caches HTML at the edge with no automatic
per-deploy invalidation ("skew protection") -- confirmed by Cloudflare's
own docs and multiple community reports of the exact same symptom, not
a zone Cache Rule (none exist on any of this project's zones) and not
anything in server/worker.ts (which does no caching of its own at all).
/closures/ on Moreno Valley stayed stale for ~20+ minutes after a
verified-successful deploy until the owner manually ran "Purge
Everything" in the Cloudflare dashboard. This script automates exactly
that step.

Purges the ENTIRE zone, not specific files -- the whole point of a
deploy is that content changed, and guessing which files to target is
the same narrow-check mistake check_deployed_content.py's own pre-
existing checks already made (neither one ever looked at /closures/).

Runs with CLOUDFLARE_CACHE_PURGE_TOKEN, a token scoped ONLY to
"Zone > Cache Purge > Purge" for the relevant zone -- deliberately
separate from CLOUDFLARE_API_TOKEN (which has Workers-edit rights for
`wrangler deploy`), least privilege: a leak of this token can purge
cache and nothing else.

Fails loud (non-zero exit, visible in the Actions UI) but must never
block or roll back the deploy itself, which has already happened by the
time this runs -- the calling workflow step sets `continue-on-error:
true` so a purge failure doesn't stop the post-deploy content check
(scripts/check_deployed_content.py) from running right after it.

Usage:
    CLOUDFLARE_CACHE_PURGE_TOKEN=... CLOUDFLARE_ZONE_ID=... \
        python -m scripts.purge_cloudflare_cache --town moreno_valley_ca
"""
from __future__ import annotations

import argparse
import os
import sys

import requests

SITE_URLS = {
    "brookings_sd": "https://brookingsview.com",
    "moreno_valley_ca": "https://morenovalleyview.com",
    "broomfield_co": "https://broomfieldview.com",
}


def purge_everything(zone_id: str, token: str) -> None:
    """Raises on any failure -- HTTP error, Cloudflare-reported failure, or
    a malformed response -- so the caller's single try/except covers every
    way this can go wrong without duplicating the checks here."""
    r = requests.post(
        f"https://api.cloudflare.com/client/v4/zones/{zone_id}/purge_cache",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json={"purge_everything": True},
        timeout=30,
    )
    try:
        body = r.json()
    except ValueError:
        body = {"raw": r.text[:500]}
    if not r.ok or not body.get("success"):
        raise RuntimeError(f"HTTP {r.status_code} -- {body}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--town", required=True, choices=sorted(SITE_URLS))
    args = ap.parse_args()

    token = os.environ.get("CLOUDFLARE_CACHE_PURGE_TOKEN")
    zone_id = os.environ.get("CLOUDFLARE_ZONE_ID")
    if not token or not zone_id:
        print(f"[{args.town}] CLOUDFLARE_CACHE_PURGE_TOKEN / CLOUDFLARE_ZONE_ID missing -- cannot purge", file=sys.stderr)
        return 1

    try:
        purge_everything(zone_id, token)
    except Exception as exc:  # noqa: BLE001 -- any failure here is reported the same way
        print(f"[{args.town}] Cloudflare cache purge FAILED: {exc}", file=sys.stderr)
        return 1

    print(f"[{args.town}] Cloudflare cache purge: ok ({SITE_URLS[args.town]})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
