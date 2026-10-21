"""Writes qa/out/blocklist.json ({town_id: [other towns' identity terms]}) from
ai_pipeline/town_guard.HARD_BLOCKLIST so the Node QA runner uses the same single source."""
from __future__ import annotations

import json
from pathlib import Path

from ai_pipeline.town_guard import HARD_BLOCKLIST


def main() -> None:
    out = Path(__file__).resolve().parent / "out" / "blocklist.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(HARD_BLOCKLIST, indent=2), encoding="utf-8")
    print(f"wrote {out} ({len(HARD_BLOCKLIST)} towns)")


if __name__ == "__main__":
    main()
