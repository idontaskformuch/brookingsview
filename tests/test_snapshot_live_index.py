"""scripts/snapshot_live_index.mjs (owner 2026-11-15, part 3 option A): Glasgow is read only at the sitemap and the addresses its
Cloudflare challenge already lets through (/tonight/, /evening-state.json); qa-daily runs it once a day for all four towns."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = (ROOT / "scripts" / "snapshot_live_index.mjs").read_text(encoding="utf-8")


def test_glasgow_reads_only_the_sitemap_and_the_excepted_addresses():
    line = next(l for l in SCRIPT.splitlines() if l.strip().startswith("glasgow:"))
    assert sorted(re.findall(r"'(/[^']*)'", line)) == ["/evening-state.json", "/sitemap-0.xml", "/tonight/"]


def test_qa_daily_snapshots_every_town_and_keeps_90_days():
    wf = (ROOT / ".github" / "workflows" / "qa-daily.yml").read_text(encoding="utf-8")
    job = wf[wf.index("  index-snapshot:"):]
    assert "town: [brookings_sd, moreno_valley_ca, broomfield_co, glasgow]" in job
    assert "node scripts/snapshot_live_index.mjs" in job and "retention-days: 90" in job
