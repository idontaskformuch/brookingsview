"""One way to fetch a third-party page (owner 2026-11-13, proposal 4 in .claude/notes/proposals-fetch-migration-register-2026-11-13.md).

    from scrapers.polite_fetch import PoliteFetcher, Refused
    got = PoliteFetcher("register", "broomfield_co").get(url)
    if isinstance(got, Refused): ...          # robots, a 403/challenge, another domain, or already fetched today
    if got.llm_excluded: ...                  # robots.txt names an AI crawler: facts only, never through a model

    python -m scrapers.polite_fetch evidence <url> --town broomfield_co --out .claude/evidence/<dir>/<name>.html

Every fetch, the robots.txt fetches included, goes through here:
1. robots.txt, read once per origin per process, one mode for every caller (owner 2026-11-18, scrapers/robots.py): our own group,
   else `*`; a Disallow there = no. A URL whose path an AI crawler's own group disallows is llm_excluded (Fetched.llm_excluded, and
   "llm_excluded": {"bot", "rule"} in the fetch log): facts may be used, the content never goes through a language model.
   Exception: the public APIs in API_TERMS follow their published API terms instead of robots.txt (owner 2026-11-13).
2. A fetch log (Ledger): one line per request. purpose evidence, dryrun and register: one fetch per URL per UTC day; a second request the
   same day gets the saved copy from that day (cache), or Refused when there is none. purpose source (feeds with refresh_minutes in the
   scraper runner) keeps its own interval, but is logged the same way.
3. A 403 or a bot challenge is a no (CLAUDE.md rule 13): Refused(link_only=True), never retried the same day; after a second one from the
   same host (on any day) the host is refused without a request. Per host, not per domain: services2/services5.arcgis.com, tockify.com
   and libcal.com are platforms shared by many organisations.
4. One UA (scrapers/user_agent.py), MAX_BYTES cap, a redirect to another domain = Refused, at least MIN_GAP_S (or the robots
   Crawl-delay) between two requests to one domain. A Crawl-delay above MAX_CRAWL_DELAY_S is never shortened (owner 2026-11-14):
   that host gets one request per run (per PoliteFetcher), the robots.txt read aside; a second one is Refused.

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
from urllib.parse import urlencode, urlparse

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
# POST is allowed only to these exact addresses, each with its minimum gap in seconds (owner 2026-11-25, order D 4: the Brookings
# facility catalog pages its list with a POST). Same robots.txt, UA, log and 403 rule as a GET; any other address is Refused.
POST_ALLOWLIST = {"https://www.cityofbrookings-sd.gov/Facilities/Facility/Search": 10.0}


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
    cut: bool = False  # the body stopped at the size cap of its request
    llm_excluded: bool = False  # robots.txt names an AI crawler: never send this body (or anything parsed from it) to a model

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


def _without_params(url: str, keys) -> str:
    """`url` with the query parameters named in `keys` removed (a secret_params value never reaches the log, the cache or a reason)."""
    from urllib.parse import parse_qsl, urlencode, urlunparse
    parts = urlparse(url)
    kept = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True) if k not in set(keys)]
    return urlunparse(parts._replace(query=urlencode(kept)))


class PoliteFetcher:
    def __init__(self, purpose: str, town_id: str | None = None, *, session=None, ledger: Ledger | None = None,
                 cache_dir: Path | None = CACHE_DIR, ua: str | None = None, clock=None, sleep=time.sleep):
        if purpose not in PURPOSES:
            raise ValueError(f"purpose {purpose!r}: expected one of {', '.join(PURPOSES)}")
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
        self._over_cap: dict[str, float] = {}  # host -> its Crawl-delay above MAX_CRAWL_DELAY_S
        self._used: set[str] = set()  # over-cap hosts that already had their one request this run
        self._llm_excluded: dict[str, dict] = {}  # url -> {"bot", "rule"}: an AI crawler's group disallows its path
        self._where = "ci" if os.environ.get("GITHUB_ACTIONS") == "true" and os.environ.get("GITHUB_RUN_ID") else "local"

    # --- the one public call ------------------------------------------------------------------------------------------------
    def get(self, url: str, params: dict | None = None, *, max_bytes: int | None = None,
            secret_params: dict | None = None) -> Fetched | Refused:
        """max_bytes: a higher size cap for this one call (owner's one-off yes 2026-11-14 for a JS bundle cut at MAX_BYTES). A saved
        copy from today that was cut at the cap it was fetched with is not a full copy for a call with a higher cap.
        secret_params: query parameters sent with the request but never written anywhere (an API key, e.g. CDOT's apiKey): the
        log, the cache, Fetched.url/final_url and every Refused carry the URL without them (2026-11-19, traffic to PoliteFetcher)."""
        url = _with_params(url, params)
        send_url = _with_params(url, secret_params) if secret_params else None
        return self._polite(url, url, send_url, None, max(max_bytes or MAX_BYTES, MAX_BYTES), tuple(secret_params or ()))

    def post(self, url: str, data: dict) -> Fetched | Refused:
        """A form POST to an address in POST_ALLOWLIST, nothing else. Logged and cached under "<url>#POST?<form>", so two
        different forms to the same address are two entries (one per day each, as for a GET)."""
        if url not in POST_ALLOWLIST:
            return Refused(url, "POST only to an address in POST_ALLOWLIST (owner 2026-11-25)")
        domain = registrable(urlparse(url).netloc)
        self._delay[domain] = max(self._delay.get(domain, 0.0), POST_ALLOWLIST[url])
        key = f"{url}#POST?{urlencode(sorted((k, '' if v is None else str(v)) for k, v in data.items()))}"
        return self._polite(url, key, url, data, MAX_BYTES, ())

    def _polite(self, url: str, key: str, send_url: str | None, data: dict | None, cap: int, secret_keys: tuple) -> Fetched | Refused:
        """robots.txt, the 403 rule, the day limit and the Crawl-delay for one request. `key` is what the log and the day cache
        record (the URL itself for a GET)."""
        parts = urlparse(url)
        if parts.scheme not in ("http", "https") or not parts.netloc:
            return Refused(url, "not an http(s) URL")
        domain = registrable(parts.netloc)
        blocked = self._blocked(parts.netloc.lower())
        if blocked:
            return blocked if blocked.url == key else Refused(key, blocked.reason, True)
        terms = api_terms(url)
        if terms is not None:
            self._delay[domain] = max(self._delay.get(domain, 0.0), terms.min_gap_s)
        else:
            verdict = self._robots_verdict(url)
            if not verdict.ok:
                return Refused(url, verdict.reason)
        excluded = url in self._llm_excluded
        if key != url and excluded:
            self._llm_excluded[key] = self._llm_excluded[url]
        if self.purpose in DAY_LIMITED:
            earlier = self._fetched_today(key)
            if earlier is not None:
                cached = self._cached(key)
                cut = cached is not None and cached.cut and cap > len(cached.body)
                if cached is not None and not cut:
                    cached.llm_excluded = excluded
                    return cached
                if not cut:
                    return Refused(key, f"already fetched today at {earlier['utc'][11:16]} UTC ({earlier['purpose']}, {earlier['where']}), "
                                        "no saved copy here: use the saved copy")
        host = parts.netloc.lower()
        if host in self._over_cap:
            if host in self._used:
                return Refused(key, f"robots.txt Crawl-delay {self._over_cap[host]:g} s is above the {MAX_CRAWL_DELAY_S:g} s cap and is "
                                    "never shortened: one request per host per run, already made")
            self._used.add(host)
        got = self._request(key, domain, self.purpose, max_bytes=cap, send_url=send_url, secret_keys=secret_keys, data=data)
        if isinstance(got, Fetched):
            got.llm_excluded = excluded
        return got

    # --- robots -------------------------------------------------------------------------------------------------------------
    def robots_verdict(self, url: str) -> _robots.Verdict:
        """The robots.txt verdict for `url` without fetching the page itself (robots.txt read once per origin and run). Used by
        scrapers/llm_gate.py to decide, at run time, whether a source's rows may reach a model."""
        return self._robots_verdict(url)

    def robots_text(self, url: str) -> tuple[int | None, str]:
        """(status, body) of the robots.txt that decides `url` (read once per origin and run, as robots_verdict reads it)."""
        parts = urlparse(url)
        origin = f"{parts.scheme}://{parts.netloc}"
        if origin not in self._robots:
            self._robots_verdict(url)
        return self._robots[origin]

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
        verdict = _robots.verdict(status, body, url)
        if verdict.llm_excluded:
            self._llm_excluded[url] = {"bot": verdict.ai_bot, "rule": verdict.ai_rule}
        if verdict.crawl_delay and verdict.crawl_delay > MAX_CRAWL_DELAY_S:
            self._over_cap[parts.netloc.lower()] = verdict.crawl_delay
        elif verdict.crawl_delay:
            self._delay[registrable(parts.netloc)] = verdict.crawl_delay
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
                            "sha256": _sha(body) if body else None, **({"note": note} if note else {}),
                            **({"llm_excluded": self._llm_excluded[url]} if url in self._llm_excluded else {})})

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
        body = path.with_suffix(".body").read_bytes()
        # copies saved before `cut` existed: one that stopped at exactly MAX_BYTES was cut (the 14 Nov _app bundle)
        return Fetched(url, meta["final_url"], meta["status"], body, meta.get("encoding"), True, meta.get("cut", len(body) == MAX_BYTES))

    def _save(self, got: Fetched) -> None:
        path = self._cache_path(got.url)
        if path is None:
            return
        path.parent.mkdir(parents=True, exist_ok=True)
        path.with_suffix(".body").write_bytes(got.body)
        path.with_suffix(".json").write_text(json.dumps({"url": got.url, "final_url": got.final_url, "status": got.status,
                                                         "encoding": got.encoding, "cut": got.cut}), encoding="utf-8")

    # --- the request --------------------------------------------------------------------------------------------------------
    def _request(self, url: str, domain: str, purpose: str, same_domain: bool = True, max_bytes: int = MAX_BYTES,
                 send_url: str | None = None, secret_keys: tuple = (), data: dict | None = None) -> Fetched | Refused:
        gap = max(MIN_GAP_S, self._delay.get(domain, 0.0))
        wait = self._last.get(domain, -1e9) + gap - time.monotonic()
        if wait > 0:
            self._sleep(wait)
        self._last[domain] = time.monotonic()
        try:
            if data is not None:  # only ever reached through post(), i.e. an address in POST_ALLOWLIST
                res = self.session.post(send_url, data=data, headers={"User-Agent": self.ua}, timeout=TIMEOUT_S, allow_redirects=True,
                                        stream=True)
            else:
                res = self.session.get(send_url or url, headers={"User-Agent": self.ua}, timeout=TIMEOUT_S, allow_redirects=True,
                                       stream=True)
            raw = getattr(res, "raw", None)
            body = raw.read(max_bytes, decode_content=True) if raw is not None else (res.content or b"")[:max_bytes]
        except Exception as exc:  # noqa: BLE001 -- any network failure is "no answer"
            self._log(url, domain, purpose, None, b"", f"no answer: {type(exc).__name__}")
            return Fetched(url, url, None)
        final = getattr(res, "url", url) or url
        if secret_keys:
            final = _without_params(final, secret_keys)
        if _is_challenge(res, body) or res.status_code == 403:
            kind = "challenge" if _is_challenge(res, body) else "403"
            self._log(url, domain, purpose, kind, b"")
            return Refused(url, f"{urlparse(url).netloc} answered {kind}: link only, not retried (rule 13)", True)
        terms = api_terms(url)
        self._log(url, domain, purpose, res.status_code, body, f"API terms, not robots.txt: {terms.terms_url}" if terms else "")
        if same_domain and registrable(urlparse(final).netloc) != domain:
            return Refused(url, f"redirected to another domain ({urlparse(final).netloc})")
        got = Fetched(url, final, res.status_code, body, getattr(res, "encoding", None), cut=len(body) >= max_bytes)
        if purpose in DAY_LIMITED and res.status_code == 200:
            self._save(got)
        return got


def source_body(got: Fetched | Refused, what: str) -> bytes:
    """The body of a scraper source's 200, or an exception the runner logs as a failed run (scrapers/runner.py run_source: the
    error is printed, saved in scraper_runs and counted toward ALERT_AFTER_FAILURES). Never a partial body: a body that reached the
    size cap fails the run instead of being parsed cut (owner 2026-11-19: "misslyckas tydligt ... inte trunkeras tyst")."""
    if isinstance(got, Refused):
        raise RuntimeError(f"{what}: polite_fetch refused {got.url}: {got.reason}")
    if got.status != 200:
        raise RuntimeError(f"{what}: {got.url} answered {got.status if got.status else 'nothing (no answer)'}")
    if got.cut:
        raise RuntimeError(f"{what}: {got.url} reached the {len(got.body)} byte size cap (polite_fetch MAX_BYTES {MAX_BYTES}); "
                           "not parsed, a cut feed would silently drop rows")
    return got.body


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
