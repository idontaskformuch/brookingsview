"""One way to fetch a third-party page (owner 2026-11-13, proposal 4 in .claude/notes/proposals-fetch-migration-register-2026-11-13.md).

    from scrapers.polite_fetch import PoliteFetcher, Refused
    got = PoliteFetcher("register", "broomfield_co", robots_mode="strict").get(url)
    if isinstance(got, Refused): ...          # robots, a 403/challenge, another domain, or already fetched today

    python -m scrapers.polite_fetch evidence <url> --town broomfield_co --out .claude/evidence/<dir>/<name>.html

Every fetch, the robots.txt fetches included, goes through here:
1. robots.txt, read once per origin per process, in the mode the caller gives per source (owner 2026-11-13):
   strict   (default) = page text that a model reads (the evening register): a robots.txt naming an AI crawler anywhere = no;
   standard = structured feeds the code parses (iCal, REST, RSS): our own group, else `*`. A disallow in standard mode always stops.
   Exception: the public APIs in API_TERMS follow their published API terms instead of robots.txt (owner 2026-11-13).
2. A fetch log (Ledger): one line per request. purpose evidence, dryrun and register: one fetch per URL per UTC day; a second request the
   same day gets the saved copy from that day (cache), or Refused when there is none. purpose source (feeds with refresh_minutes in the
   scraper runner) keeps its own interval, but is logged the same way.
3. A 403 or a bot challenge is a no (CLAUDE.md rule 13): Refused(link_only=True), never retried the same day; after a second one from the
   same host (on any day) the host is refused without a request. Per host, not per domain: services2/services5.arcgis.com, tockify.com
   and libcal.com are platforms shared by many organisations.
4. One UA (scrapers/user_agent.py), MAX_BYTES cap, a redirect to another domain = Refused, at least MIN_GAP_S (or the robots
   Crawl-delay) between two requests to one domain.

The log is local for now (FileLedger: .claude/fetch-ledger/<YYYY-MM-DD>.jsonl). How local runs and CI share one log is a proposal
waiting for the owner (state.md); a shared Ledger plugs in here without changing callers.
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Protocol
from urllib.parse import urlparse

from scrapers import robots as _robots
from scrapers.user_agent import user_agent

_REPO_ROOT = Path(__file__).resolve().parent.parent
LEDGER_DIR = _REPO_ROOT / ".claude" / "fetch-ledger"
CACHE_DIR = _REPO_ROOT / ".cache" / "polite_fetch"
PURPOSES = ("evidence", "dryrun", "register", "source")
DAY_LIMITED = ("evidence", "dryrun", "register")
MAX_BYTES = 1_500_000
MIN_GAP_S = 1.0
MAX_CRAWL_DELAY_S = 60.0
TIMEOUT_S = 25
BLOCKED_STATUSES = ("403", "challenge")


@dataclass(frozen=True)
class ApiTerms:
    """A public API whose robots.txt disallows the endpoint for crawlers but whose operator publishes terms for API clients
    (owner 2026-11-13: these terms apply, not robots.txt). What the terms ask and how we meet it:
    an identifying UA with contact (scrapers/user_agent.py: ViewMediaBot (+https://<town>/contact)), at most one request per
    min_gap_s to the host, and the attribution shown wherever the data appears on the site."""
    host: str
    path: str  # path prefix the exception covers
    terms_url: str
    min_gap_s: float
    attribution: str


API_TERMS = (
    # Overpass: "less than 10,000 queries per day and less than 1 GB download"; one query at a time. We run weekly per town.
    ApiTerms("overpass-api.de", "/api/", "https://wiki.openstreetmap.org/wiki/Overpass_API#Public_Overpass_API_instances", 5.0,
             "© OpenStreetMap contributors (ODbL), https://www.openstreetmap.org/copyright: TonightRows, OpenTonight, areas/*.json"),
    # Nominatim: "an absolute maximum of 1 request per second", identifying UA, no bulk geocoding, attribution.
    ApiTerms("nominatim.openstreetmap.org", "/search", "https://operations.osmfoundation.org/policies/nominatim/", 1.0,
             "© OpenStreetMap contributors (ODbL), https://www.openstreetmap.org/copyright"),
    # Commons API etiquette + the Wikimedia User-Agent policy: serial requests, UA with contact, maxlag on queries.
    ApiTerms("commons.wikimedia.org", "/w/api.php", "https://www.mediawiki.org/wiki/API:Etiquette", 1.0,
             "per-file author + licence from extmetadata: site/src/components/ImageAttribution.astro"),
)


def api_terms(url: str) -> ApiTerms | None:
    parts = urlparse(url)
    return next((t for t in API_TERMS if parts.netloc.lower() == t.host and (parts.path or "/").startswith(t.path)), None)


@dataclass
class Fetched:
    url: str
    final_url: str
    status: int | None  # None = no answer (timeout, DNS)
    body: bytes = b""
    encoding: str | None = None
    from_cache: bool = False

    @property
    def text(self) -> str:
        try:
            return self.body.decode("utf-8")
        except UnicodeDecodeError:
            return self.body.decode(self.encoding or "latin-1", errors="replace")


@dataclass
class Refused:
    url: str
    reason: str
    link_only: bool = False  # rule 13: show as a plain link, never fetch


class Ledger(Protocol):
    def append(self, entry: dict) -> None: ...
    def entries(self) -> list[dict]: ...


@dataclass
class MemoryLedger:
    """For tests and one-off checks that must leave no trace."""
    rows: list[dict] = field(default_factory=list)

    def append(self, entry: dict) -> None:
        self.rows.append(entry)

    def entries(self) -> list[dict]:
        return list(self.rows)


@dataclass
class FileLedger:
    """JSON lines per UTC day in LEDGER_DIR (the notes repo, committed with the evidence it explains)."""
    directory: Path = LEDGER_DIR

    def append(self, entry: dict) -> None:
        self.directory.mkdir(parents=True, exist_ok=True)
        with (self.directory / f"{entry['utc'][:10]}.jsonl").open("a", encoding="utf-8", newline="\n") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")

    def entries(self) -> list[dict]:
        out: list[dict] = []
        for path in sorted(self.directory.glob("*.jsonl")) if self.directory.is_dir() else []:
            for line in path.read_text(encoding="utf-8").splitlines():
                if line.strip():
                    out.append(json.loads(line))
        return out


def registrable(host: str) -> str:
    parts = host.lower().split(":")[0].removeprefix("www.").split(".")
    return ".".join(parts[-3:] if len(parts) > 2 and parts[-2] in ("co", "org", "com", "ac", "gov") else parts[-2:])


def _host(url: str) -> str:
    return urlparse(url).netloc.lower()


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _is_challenge(res, body: bytes) -> bool:
    headers = {k.lower(): v for k, v in (getattr(res, "headers", None) or {}).items()}
    if headers.get("cf-mitigated", "").lower() == "challenge":
        return True
    head = body[:4000].lower()
    return getattr(res, "status_code", None) in (403, 429, 503) and (b"challenge-platform" in head or b"just a moment..." in head)


def _with_params(url: str, params: dict | None) -> str:
    if not params:
        return url
    from requests.models import PreparedRequest
    req = PreparedRequest()
    req.prepare_url(url, params)
    return req.url


class PoliteFetcher:
    def __init__(self, purpose: str, town_id: str | None = None, *, session=None, ledger: Ledger | None = None,
                 cache_dir: Path | None = CACHE_DIR, ua: str | None = None, clock=None, sleep=time.sleep, robots_mode: str = "strict"):
        if purpose not in PURPOSES:
            raise ValueError(f"purpose {purpose!r}: expected one of {', '.join(PURPOSES)}")
        if robots_mode not in _robots.MODES:
            raise ValueError(f"robots_mode {robots_mode!r}: expected one of {', '.join(_robots.MODES)}")
        self.robots_mode = robots_mode
        if session is None:
            import requests
            session = requests.Session()
        self.purpose, self.town_id, self.session = purpose, town_id, session
        self.ledger = ledger if ledger is not None else FileLedger()
        self.cache_dir = cache_dir
        self.ua = ua or user_agent(town_id)
        self._clock = clock or (lambda: datetime.now(timezone.utc))
        self._sleep = sleep
        self._robots: dict[str, tuple[int | None, str]] = {}
        self._last: dict[str, float] = {}
        self._delay: dict[str, float] = {}
        self._where = "ci" if os.environ.get("GITHUB_ACTIONS") == "true" and os.environ.get("GITHUB_RUN_ID") else "local"

    # --- the one public call ------------------------------------------------------------------------------------------------
    def get(self, url: str, params: dict | None = None) -> Fetched | Refused:
        url = _with_params(url, params)
        parts = urlparse(url)
        if parts.scheme not in ("http", "https") or not parts.netloc:
            return Refused(url, "not an http(s) URL")
        domain = registrable(parts.netloc)
        blocked = self._blocked(parts.netloc.lower())
        if blocked:
            return blocked if blocked.url == url else Refused(url, blocked.reason, True)
        terms = api_terms(url)
        if terms is not None:
            self._delay[domain] = max(self._delay.get(domain, 0.0), terms.min_gap_s)
        else:
            verdict = self._robots_verdict(url)
            if not verdict.ok:
                return Refused(url, verdict.reason)
        if self.purpose in DAY_LIMITED:
            earlier = self._fetched_today(url)
            if earlier is not None:
                cached = self._cached(url)
                if cached is not None:
                    return cached
                return Refused(url, f"already fetched today at {earlier['utc'][11:16]} UTC ({earlier['purpose']}, {earlier['where']}), "
                                    "no saved copy here: use the saved copy")
        return self._request(url, domain, self.purpose)

    # --- robots -------------------------------------------------------------------------------------------------------------
    def _robots_verdict(self, url: str) -> _robots.Verdict:
        parts = urlparse(url)
        origin = f"{parts.scheme}://{parts.netloc}"
        if origin not in self._robots:
            got = self._request(f"{origin}/robots.txt", registrable(parts.netloc), "robots", same_domain=False)
            if isinstance(got, Refused):
                self._robots[origin] = (403, "")
            else:
                self._robots[origin] = (got.status, got.text if got.status == 200 else "")
        status, body = self._robots[origin]
        verdict = _robots.verdict(status, body, url, mode=self.robots_mode)
        if verdict.crawl_delay:
            self._delay[registrable(parts.netloc)] = min(verdict.crawl_delay, MAX_CRAWL_DELAY_S)
        return verdict

    # --- ledger -------------------------------------------------------------------------------------------------------------
    def _blocked(self, host: str) -> Refused | None:
        hits = [e for e in self.ledger.entries() if _host(e.get("url", "")) == host and str(e.get("status")) in BLOCKED_STATUSES]
        today = self._clock().date().isoformat()
        if len(hits) >= 2:
            return Refused(hits[-1]["url"], f"{host} answered 403/challenge twice ({hits[0]['utc'][:10]}, {hits[-1]['utc'][:10]}): "
                                            "link only (rule 13)", True)
        if hits and hits[-1]["utc"][:10] == today:
            return Refused(hits[-1]["url"], f"{host} answered 403/challenge today at {hits[-1]['utc'][11:16]} UTC: link only, "
                                            "at most one new attempt on a later day (rule 13)", True)
        return None

    def _fetched_today(self, url: str) -> dict | None:
        today = self._clock().date().isoformat()
        return next((e for e in self.ledger.entries() if e.get("url") == url and e.get("utc", "")[:10] == today
                     and e.get("purpose") in DAY_LIMITED and e.get("status") is not None), None)

    def _log(self, url: str, domain: str, purpose: str, status, body: bytes, note: str = "") -> None:
        self.ledger.append({"utc": self._clock().isoformat(timespec="seconds"), "url": url, "domain": domain, "purpose": purpose,
                            "town_id": self.town_id, "where": self._where, "status": status, "bytes": len(body),
                            "sha256": _sha(body) if body else None, **({"note": note} if note else {})})

    # --- day cache ----------------------------------------------------------------------------------------------------------
    def _cache_path(self, url: str) -> Path | None:
        if self.cache_dir is None:
            return None
        return self.cache_dir / self._clock().date().isoformat() / _sha(url.encode())[:32]

    def _cached(self, url: str) -> Fetched | None:
        path = self._cache_path(url)
        if path is None or not path.with_suffix(".json").is_file():
            return None
        meta = json.loads(path.with_suffix(".json").read_text(encoding="utf-8"))
        return Fetched(url, meta["final_url"], meta["status"], path.with_suffix(".body").read_bytes(), meta.get("encoding"), True)

    def _save(self, got: Fetched) -> None:
        path = self._cache_path(got.url)
        if path is None:
            return
        path.parent.mkdir(parents=True, exist_ok=True)
        path.with_suffix(".body").write_bytes(got.body)
        path.with_suffix(".json").write_text(json.dumps({"url": got.url, "final_url": got.final_url, "status": got.status,
                                                         "encoding": got.encoding}), encoding="utf-8")

    # --- the request --------------------------------------------------------------------------------------------------------
    def _request(self, url: str, domain: str, purpose: str, same_domain: bool = True) -> Fetched | Refused:
        gap = max(MIN_GAP_S, self._delay.get(domain, 0.0))
        wait = self._last.get(domain, -1e9) + gap - time.monotonic()
        if wait > 0:
            self._sleep(wait)
        self._last[domain] = time.monotonic()
        try:
            res = self.session.get(url, headers={"User-Agent": self.ua}, timeout=TIMEOUT_S, allow_redirects=True, stream=True)
            raw = getattr(res, "raw", None)
            body = raw.read(MAX_BYTES, decode_content=True) if raw is not None else (res.content or b"")[:MAX_BYTES]
        except Exception as exc:  # noqa: BLE001 -- any network failure is "no answer"
            self._log(url, domain, purpose, None, b"", f"no answer: {type(exc).__name__}")
            return Fetched(url, url, None)
        final = getattr(res, "url", url) or url
        if _is_challenge(res, body) or res.status_code == 403:
            kind = "challenge" if _is_challenge(res, body) else "403"
            self._log(url, domain, purpose, kind, b"")
            return Refused(url, f"{urlparse(url).netloc} answered {kind}: link only, not retried (rule 13)", True)
        terms = api_terms(url)
        self._log(url, domain, purpose, res.status_code, body, f"API terms, not robots.txt: {terms.terms_url}" if terms else "")
        if same_domain and registrable(urlparse(final).netloc) != domain:
            return Refused(url, f"redirected to another domain ({urlparse(final).netloc})")
        got = Fetched(url, final, res.status_code, body, getattr(res, "encoding", None))
        if purpose in DAY_LIMITED and res.status_code == 200:
            self._save(got)
        return got


def main(argv: list[str]) -> int:
    import argparse
    ap = argparse.ArgumentParser(prog="python -m scrapers.polite_fetch")
    ap.add_argument("purpose", choices=("evidence",))
    ap.add_argument("url")
    ap.add_argument("--town", required=True)
    ap.add_argument("--out", required=True, help="where the page is saved (an evidence file)")
    args = ap.parse_args(argv)
    got = PoliteFetcher(args.purpose, args.town).get(args.url)
    if isinstance(got, Refused):
        print(f"REFUSED: {got.reason}")
        return 1
    print(f"{got.status} {got.final_url} {len(got.body)} bytes{' (saved copy from today)' if got.from_cache else ''}")
    if got.status != 200:
        return 1
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(got.body)
    print(f"saved {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
