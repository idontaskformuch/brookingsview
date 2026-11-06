"""scripts/indexnow.py: ping only changed sitemap URLs, never without a baseline, one call per domain."""
import json

from scripts import indexnow as ix

SITEMAP_INDEX = '<sitemapindex><sitemap><loc>https://example.test/sitemap-0.xml</loc></sitemap></sitemapindex>'


def _dist(tmp_path, pages):
    dist = tmp_path / "site" / "dist"
    dist.mkdir(parents=True)
    (dist / "sitemap-index.xml").write_text(SITEMAP_INDEX.replace("example.test", "glasgowloop.co.uk"), encoding="utf-8")
    locs = "".join(f"<url><loc>https://glasgowloop.co.uk{p}</loc></url>" for p in pages)
    (dist / "sitemap-0.xml").write_text(f"<urlset>{locs}</urlset>", encoding="utf-8")
    for p, html in pages.items():
        f = dist / p.lstrip("/") / "index.html"
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(html, encoding="utf-8")
    return dist


def test_hash_ignores_scripts_styles_comments_whitespace():
    a = "<p>Hi</p><script>var b=1</script><!-- x --><style>a{}</style>"
    b = "<p>Hi</p>\n  <script>var b=2</script><style>b{}</style>"
    assert ix.content_hash(a) == ix.content_hash(b)
    assert ix.content_hash("<p>Hi</p>") != ix.content_hash("<p>Ho</p>")


def test_no_baseline_pings_nothing_and_changed_only_otherwise():
    new = {"u1": "a", "u2": "b", "u3": "c"}
    assert ix.changed_urls(new, None) == []
    assert ix.changed_urls(new, {"u1": "a", "u2": "x"}) == ["u2", "u3"]
    assert ix.changed_urls(new, new) == []


def test_prepare_then_ping_one_call_with_only_changed(tmp_path, monkeypatch):
    dist = _dist(tmp_path, {"/": "<p>home</p>", "/a/": "<p>a v1</p>"})
    old = ix.build_manifest(dist, "glasgowloop.co.uk")
    (dist / "a" / "index.html").write_text("<p>a v2</p>", encoding="utf-8")
    (dist / "b").mkdir()
    (dist / "b" / "index.html").write_text("<p>b</p>", encoding="utf-8")
    (dist / "sitemap-0.xml").write_text(
        "<urlset>" + "".join(f"<url><loc>https://glasgowloop.co.uk{p}</loc></url>" for p in ("/", "/a/", "/b/")) + "</urlset>", encoding="utf-8")
    monkeypatch.setattr(ix, "fetch_live_manifest", lambda site: old)
    assert ix.cmd_prepare("glasgow", dist) == 0
    assert json.loads((dist / ix.MANIFEST_NAME).read_text()).keys() == {"https://glasgowloop.co.uk/" + x for x in ("", "a/", "b/")}
    calls = []

    class R:
        status_code = 202
    monkeypatch.setattr(ix, "post_batches", lambda site, urls, post=None: calls.append((site, urls)) or [202])
    assert ix.cmd_ping("glasgow", dist) == 0
    assert calls == [("https://glasgowloop.co.uk", ["https://glasgowloop.co.uk/a/", "https://glasgowloop.co.uk/b/"])]
    assert ix.cmd_ping("glasgow", dist) == 0 and len(calls) == 1  # pending is consumed


def test_unchanged_and_baseline_make_no_call(tmp_path, monkeypatch):
    dist = _dist(tmp_path, {"/": "<p>home</p>"})
    monkeypatch.setattr(ix, "post_batches", lambda *a, **k: (_ for _ in ()).throw(AssertionError("must not ping")))
    monkeypatch.setattr(ix, "fetch_live_manifest", lambda site: None)
    ix.cmd_prepare("glasgow", dist)
    assert (dist / ix.MANIFEST_NAME).exists()
    ix.cmd_ping("glasgow", dist)
    monkeypatch.setattr(ix, "fetch_live_manifest", lambda site: ix.build_manifest(dist, "glasgowloop.co.uk"))
    ix.cmd_prepare("glasgow", dist)
    ix.cmd_ping("glasgow", dist)


def test_other_hosts_are_not_submitted(tmp_path):
    dist = _dist(tmp_path, {"/": "<p>x</p>"})
    assert ix.build_manifest(dist, "other.example") == {}


def test_batches_of_10000_and_body_shape():
    sent = []

    class R:
        status_code = 202
    urls = [f"https://glasgowloop.co.uk/{i}/" for i in range(10001)]
    codes = ix.post_batches("https://glasgowloop.co.uk", urls, post=lambda url, json, headers, timeout: sent.append((url, json)) or R())
    assert codes == [202, 202] and len(sent) == 2 and sent[0][0] == ix.ENDPOINT
    assert sent[0][1]["host"] == "glasgowloop.co.uk" and sent[0][1]["keyLocation"].endswith(f"/{ix.KEY}.txt")


def test_key_matches_the_public_key_file():
    assert len(ix.KEY) == 32
    assert (ix.ROOT / "site" / "public" / f"{ix.KEY}.txt").read_text().strip() == ix.KEY


def test_hash_ignores_build_sha_meta():
    a = '<head><meta name="build-sha" content="abc"></head><p>x</p>'
    b = '<head><meta name="build-sha" content="def"></head><p>x</p>'
    assert ix.content_hash(a) == ix.content_hash(b)


def test_hash_ignores_the_data_built_at_meta():
    a = '<head><meta name="data-built-at" content="2026-11-06T10:00:00Z"></head><p>x</p>'
    b = '<head><meta name="data-built-at" content="2026-11-06T22:00:00Z"></head><p>x</p>'
    assert ix.content_hash(a) == ix.content_hash(b)
