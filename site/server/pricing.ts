// Small TypeScript mirror of config/pricing.py's ANTHROPIC_PRICING, for the
// Worker's comment-moderation call (site/server/comment.ts) -- a separate
// runtime from the Python pipeline, can't import that file directly.
//
// Spec: API Cost Logging (2026-10-01). Only the one model the worker
// actually calls is listed here; keep in sync by hand with config/pricing.py
// when a price changes. See that file's own docstring for the source/date.

export const ANTHROPIC_PRICING: Record<string, { inputPerToken: number; outputPerToken: number }> = {
  'claude-haiku-4-5-20251001': { inputPerToken: 1.0 / 1_000_000, outputPerToken: 5.0 / 1_000_000 },
};

/** Cost in USD, or null (+ a console warning) for a model this file doesn't
 * know the price of -- never guess a price and silently log a wrong number. */
export function costForAnthropic(
  model: string,
  inputTokens: number | null,
  outputTokens: number | null,
): number | null {
  const price = ANTHROPIC_PRICING[model];
  if (!price) {
    console.warn(`[pricing] unknown Anthropic model ${model} -- logging cost_usd=NULL instead of guessing`);
    return null;
  }
  return (inputTokens ?? 0) * price.inputPerToken + (outputTokens ?? 0) * price.outputPerToken;
}
