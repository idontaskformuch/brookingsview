"""Adapter registry. An adapter is `fetch(params: dict) -> list[NormalizedEvent | NormalizedStanding]`, registered by name.

`params` is the config source entry without its `adapter` key, with its `params` mapping merged in (program, sport, level, gender, url, ...).
No town-specific branches in adapter code: everything town-specific arrives through params.

Each adapter module declares in its docstring: robots.txt handling and the source's ToS status.
"""
from __future__ import annotations

from typing import Callable

from sports.models import NormalizedEvent, NormalizedStanding

Adapter = Callable[[dict], "list[NormalizedEvent | NormalizedStanding]"]
_ADAPTERS: dict[str, Adapter] = {}


def register(name: str) -> Callable[[Adapter], Adapter]:
    def deco(fn: Adapter) -> Adapter:
        if name in _ADAPTERS:
            raise ValueError(f"adapter {name!r} already registered")
        _ADAPTERS[name] = fn
        return fn
    return deco


def get(name: str) -> Adapter:
    try:
        return _ADAPTERS[name]
    except KeyError:
        raise KeyError(f"unknown adapter {name!r}; registered: {', '.join(sorted(_ADAPTERS)) or '(none)'}") from None


def names() -> tuple[str, ...]:
    return tuple(sorted(_ADAPTERS))


def merged_params(source: dict) -> dict:
    out = {k: v for k, v in source.items() if k not in ("adapter", "params")}
    out.update(source.get("params") or {})
    return out


from sports.adapters import internal  # noqa: E402,F401  (registers "internal"; imported last because it uses register())
