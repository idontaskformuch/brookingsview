"""IMAGE_HISTORY_WRITE=1 is set on the build step of every production build and nowhere else.

Fas 0.5 (owner 2026-11-18, qa/checks.json build.no-db-write-without-flag): the site build's only database write
(site/src/lib/db.ts recordThisWeekImageUse, the this_week_image_usage history) runs only with the flag. Every CI
workflow whose build is followed by a wrangler deploy must set it on that build step, or the week's pick is never
recorded and the 60-day rule loses its history; nothing else (tests.yml, battery.sh, review-shots, local runs) may
set it. Read as text, same as test_scrape_workflow_env.py.
"""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WORKFLOWS = ROOT / ".github" / "workflows"
FLAG_LINE = re.compile(r"^\s+IMAGE_HISTORY_WRITE: '1'", re.M)
BUILD_RUN = re.compile(r"run:\s*(npx astro build|bash \.\./scripts/build_retry\.sh)")
DEPLOY = re.compile(r"wrangler_deploy_retry|wrangler deploy")


def build_step(text: str) -> str:
    """The step (from its '- name:' to the next one) whose run: is the site build."""
    steps = re.split(r"(?m)^(?=\s+- name:)", text)
    found = [s for s in steps if BUILD_RUN.search(s)]
    assert len(found) == 1, f"expected exactly one build step, found {len(found)}"
    return found[0]


def deploying_workflows() -> list[Path]:
    return [p for p in sorted(WORKFLOWS.glob("*.yml")) if DEPLOY.search(p.read_text(encoding="utf-8"))]


def test_every_production_build_step_sets_the_flag():
    paths = deploying_workflows()
    assert len(paths) >= 20  # 2026-11-18: 20 workflows build + deploy
    missing = [p.name for p in paths if not FLAG_LINE.search(build_step(p.read_text(encoding="utf-8")))]
    assert missing == []


def test_flag_appears_only_on_the_build_step():
    for p in sorted(WORKFLOWS.glob("*.yml")):
        text = p.read_text(encoding="utf-8")
        n = len(re.findall(r"IMAGE_HISTORY_WRITE", text))
        if DEPLOY.search(text):
            assert n == 1, p.name
        else:
            assert n == 0, p.name


def test_nothing_outside_ci_sets_the_flag():
    hits = []
    for base in ("scripts", "qa", "site/scripts"):
        for p in (ROOT / base).rglob("*"):
            # qa/checks.json describes the flag in prose; it sets nothing.
            if p.is_file() and p.suffix in {".sh", ".mjs", ".js", ".py", ".ts", ".json"} and p.name != "checks.json":
                code = [ln for ln in p.read_text(encoding="utf-8", errors="ignore").splitlines()
                        if not re.match(r"\s*(//|#|\*)", ln)]
                if any(re.search(r"IMAGE_HISTORY_WRITE\s*[:=]\s*['\"]?1", ln) for ln in code):
                    hits.append(str(p.relative_to(ROOT)))
    for name in ("vitest.config.ts", "astro.config.mjs", ".env"):
        p = ROOT / "site" / name
        if p.exists() and "IMAGE_HISTORY_WRITE" in p.read_text(encoding="utf-8", errors="ignore"):
            hits.append(f"site/{name}")
    assert hits == []


def test_build_step_parser_on_a_real_step():
    # The real Build (Brookings) step of scrape.yml at 28dcd07, without and with the flag line.
    step = (
        "      - name: Build (Brookings)\n"
        "        working-directory: site\n"
        "        env:\n"
        "          SITE_CITY: brookings_sd\n"
        "          DATABASE_URL: ${{ secrets.DATABASE_URL }}\n"
        "        run: npx astro build\n"
        "      - name: Deploy to Cloudflare Workers (Brookings)\n"
        "        run: bash ../scripts/wrangler_deploy_retry.sh --env brookings\n"
    )
    assert not FLAG_LINE.search(build_step(step))
    flagged = step.replace("${{ secrets.DATABASE_URL }}\n", "${{ secrets.DATABASE_URL }}\n          IMAGE_HISTORY_WRITE: '1'\n")
    assert FLAG_LINE.search(build_step(flagged))
