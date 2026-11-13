"""Repair UTF-8 text that was read as Windows-1252 and written back as UTF-8 ("Ã¤" for "ä"), in place, touching
nothing else: only runs that decode cleanly back to UTF-8 are replaced, so correct å/ä/ö in the same file stay as
they are. Also drops the BOM such a round trip adds. (.claude/state.md, 2026-11-13: PowerShell 5.1
`Get-Content -Raw | Set-Content -Encoding utf8` without -Encoding on the read.)

    python -m scripts.fix_mojibake FILE [--check]

--check only reports (exit 1 when the file has mojibake or a BOM); without it the file is rewritten and every
replacement is listed.
"""
from __future__ import annotations

import re
import sys
from collections import Counter
from pathlib import Path

BOM = "﻿"
# A UTF-8 lead byte (0xC2-0xF4) shown as its cp1252 character, then 1-3 continuation bytes (0x80-0xBF) shown as theirs.
_CP1252_HIGH = "".join(bytes([b]).decode("cp1252", "replace") for b in range(0x80, 0xC0)).replace("�", "")
_CONT = "[" + re.escape(_CP1252_HIGH + "".join(chr(c) for c in (0x81, 0x8D, 0x8F, 0x90, 0x9D))) + "]"
MOJIBAKE = re.compile(f"[Â-ô]{_CONT}{{1,3}}")


def _to_byte(ch: str) -> int:
    try:
        return ch.encode("cp1252")[0]
    except UnicodeEncodeError:
        return ord(ch)  # the five bytes cp1252 leaves undefined come back as U+0081 etc.


def repair(text: str) -> tuple[str, Counter]:
    fixes: Counter = Counter()

    def sub(m: re.Match) -> str:
        try:
            good = bytes(_to_byte(c) for c in m.group()).decode("utf-8")
        except (UnicodeDecodeError, ValueError):
            return m.group()
        fixes[(m.group(), good)] += 1
        return good

    return MOJIBAKE.sub(sub, text.removeprefix(BOM)), fixes


def main(argv: list[str]) -> int:
    path = Path(argv[0])
    text = path.read_bytes().decode("utf-8")
    fixed, fixes = repair(text)
    if "--check" in argv:
        bad = sum(fixes.values())
        if bad or text.startswith(BOM):
            print(f"{path}: {bad} mojibake sequence(s){', BOM' if text.startswith(BOM) else ''}")
            return 1
        return 0
    if fixed != text:
        path.write_bytes(fixed.encode("utf-8"))
    for (bad, good), n in sorted(fixes.items(), key=lambda kv: -kv[1]):
        print(f"{n:4}  {bad!r} -> {good!r}")
    print(f"{path}: {sum(fixes.values())} replaced, BOM {'removed' if text.startswith(BOM) else 'none'}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
