"""One node pin (owner 2026-11-27): site/.nvmrc. tests.yml, the four *deploy.yml and the four *scrape.yml (which also build and deploy) read it
with node-version-file, so a scrape-triggered build no longer runs the runner's default node (found 2026-11-26) and a version bump is one file."""
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
WORKFLOWS = ["tests.yml", "deploy.yml", "broomfield-deploy.yml", "glasgow-deploy.yml", "moval-deploy.yml",
             "scrape.yml", "broomfield-scrape.yml", "glasgow-scrape.yml", "moval-scrape.yml"]


def test_nvmrc_is_the_astro_7_version():
    assert (ROOT / "site" / ".nvmrc").read_text(encoding="utf-8").strip() == "24.18.0"


@pytest.mark.parametrize("name", WORKFLOWS)
def test_every_setup_node_reads_the_nvmrc(name):
    text = (ROOT / ".github" / "workflows" / name).read_text(encoding="utf-8")
    steps = re.split(r"\n\s*- ", text)
    node = [s for s in steps if "actions/setup-node@" in s]
    assert node, name
    for step in node:
        assert "node-version-file: site/.nvmrc" in step and "node-version:" not in step, f"{name}: {step!r}"
