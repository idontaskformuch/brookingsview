"""Single source of truth for paid-API prices used by api_usage cost logging.

Spec: API Cost Logging (2026-10-01), "Priserna ligger i en enda konfigfil...
inte inbakade i anropen." Kept separate from ai_pipeline/format_prompt.py's
own MODEL_PRICING (which only drives the pre-existing .ai_budget.json
monthly-cap check) so a price update only needs editing here -- but that
dict now delegates to this module rather than duplicating the numbers, see
format_prompt.pricing_for().

site/server/pricing.ts is the TypeScript mirror for the Cloudflare worker's
comment-moderation call (a separate runtime, can't import this file).
Keep the two in sync by hand when a price changes -- the worker only ever
calls one model (Haiku, comment moderation), so the mirror is intentionally
a small subset, not a full port.

Unknown model/provider -> cost_for_*() returns None and the caller logs a
warning. Never guess a price and silently log a wrong number.
"""
from __future__ import annotations

import sys

# USD per token. Source: anthropic.com/pricing, checked 2026-10-01 (same
# list format_prompt.MODEL_PRICING already used before this module existed).
ANTHROPIC_PRICING: dict[str, tuple[float, float]] = {
    "claude-sonnet-5": (3.0 / 1_000_000, 15.0 / 1_000_000),
    "claude-haiku-4-5-20251001": (1.0 / 1_000_000, 5.0 / 1_000_000),
}

# Prompt-caching token prices, by model: (cache_write_usd_per_token,
# cache_read_usd_per_token). Not used by any call site yet (caching is out
# of scope per the spec -- "Utanför scope: ... prompt caching"), but the
# api_usage columns are populated now so caching becomes visible the moment
# it's turned on, without a second migration. Cache write is priced at a
# 1.25x premium over a normal input token, cache read at 0.1x, per
# Anthropic's published caching pricing -- derived from ANTHROPIC_PRICING's
# input price rather than hardcoded twice.
ANTHROPIC_CACHE_PRICING: dict[str, tuple[float, float]] = {
    model: (price_in * 1.25, price_in * 0.1)
    for model, (price_in, _price_out) in ANTHROPIC_PRICING.items()
}

# Brave Search: flat per-request list price (Data for AI / Pro plan tier --
# see ai_pipeline/search_client.py's docstring for why this is the only
# search provider in the pipeline). $5 / 1000 requests, matching the
# estimate already used in ai_pipeline/search_budget.py's own docstring.
BRAVE_PRICE_PER_REQUEST = 5.0 / 1000

# fal.ai: per-image list price, by the (provider, model) key config/
# image_model.py's MODEL_IDS already uses -- NOT by fal's own model-id
# string, so this stays correct if MODEL_IDS ever points the same logical
# model at a different fal endpoint. Checked against fal.ai/pricing
# 2026-10-01. Replicate has no entry here -- it's configured but unused
# (IMAGE_API_PROVIDER="fal"); it is explicitly out of this spec's scope.
FAL_PRICE_PER_IMAGE: dict[tuple[str, str], float] = {
    ("fal", "flux"): 0.025,   # fal-ai/flux/dev
    ("fal", "sdxl"): 0.01,    # fal-ai/fast-sdxl
}


def _warn(msg: str) -> None:
    print(f"  [pricing] {msg}", file=sys.stderr)


def cost_for_anthropic(model: str | None, input_tokens: int | None, output_tokens: int | None,
                        cache_read_tokens: int | None = None,
                        cache_write_tokens: int | None = None) -> float | None:
    """Cost in USD for one Anthropic call, or None (+ a warning) for a model
    this config doesn't know the price of. Never falls back to another
    model's price here -- format_prompt.pricing_for() does that on purpose
    for the budget-cap check (safe to overestimate there); a per-call cost
    LOG must never silently attribute spend to the wrong model."""
    if model not in ANTHROPIC_PRICING:
        _warn(f"unknown Anthropic model {model!r} -- logging cost_usd=NULL instead of guessing")
        return None
    price_in, price_out = ANTHROPIC_PRICING[model]
    cost = (input_tokens or 0) * price_in + (output_tokens or 0) * price_out
    if cache_read_tokens or cache_write_tokens:
        cache_write_price, cache_read_price = ANTHROPIC_CACHE_PRICING[model]
        cost += (cache_write_tokens or 0) * cache_write_price + (cache_read_tokens or 0) * cache_read_price
    return cost


def cost_for_brave(requests: int = 1) -> float:
    return requests * BRAVE_PRICE_PER_REQUEST


def cost_for_fal(provider: str, model: str, images: int = 1) -> float | None:
    key = (provider, model)
    if key not in FAL_PRICE_PER_IMAGE:
        _warn(f"unknown fal (provider, model) {key!r} -- logging cost_usd=NULL instead of guessing")
        return None
    return images * FAL_PRICE_PER_IMAGE[key]
