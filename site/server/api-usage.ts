// Spec: API Cost Logging (2026-10-01). TS-side counterpart to
// ai_pipeline/api_usage.py's log_usage() -- writes to the same shared
// api_usage table (db/migrations/046_api_usage.sql) via the neon driver
// this Worker already uses (see ai-crawler-log.ts for the identical
// fire-and-forget pattern this follows).
//
// Fire-and-forget: callers pass the returned promise to ctx.waitUntil() so
// logging never delays the actual response. Errors are swallowed with a
// console.error, not rethrown -- matching the Python side's "a failed log
// call must never stop a publication" rule (here: must never stop a
// comment being moderated/posted).

export interface ApiUsageRow {
  runId: string;
  townId: string | null;
  generator: string;
  provider: 'anthropic' | 'brave' | 'fal';
  model?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  costUsd?: number | null;
  attempt?: number;
  outcome: 'published' | 'guardrail_rejected' | 'template_fallback' | 'error' | 'dry_run' | 'pending';
}

export async function logApiUsage(
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>,
  row: ApiUsageRow,
): Promise<void> {
  try {
    await sql`
      INSERT INTO api_usage
          (run_id, town_id, generator, provider, model, input_tokens, output_tokens, cost_usd, attempt, outcome)
      VALUES (${row.runId}, ${row.townId}, ${row.generator}, ${row.provider}, ${row.model ?? null},
              ${row.inputTokens ?? null}, ${row.outputTokens ?? null}, ${row.costUsd ?? null},
              ${row.attempt ?? 1}, ${row.outcome})
    `;
  } catch (err) {
    console.error('logApiUsage failed:', err);
  }
}
