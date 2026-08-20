// POST /api/comment -- AI-moderated, no-login comments, scoped to Worker
// Pulse pages only (Moreno Valley). Every comment passes a moderation gate
// BEFORE it's ever visible.
//
// This runs inside the site's single Worker entry (server/worker.ts), which
// is the ONLY thing Cloudflare actually invokes in production (see the
// comment at the top of worker.ts for why -- this used to live under
// site/functions/ as a Cloudflare Pages Function, which is a dead code path
// for this project's deploy method and never ran in production).
//
// It does NOT go through ai_pipeline/guardrails.py, which is Python and
// only runs in GitHub Actions batch jobs and has no reachable path from
// here. This is a deliberately separate implementation that mirrors the
// same PHILOSOPHY as that module (cheap heuristic pre-filter first, then a
// Haiku-tier AI call, fail-safe on error rather than fail-open) rather than
// literally reusing its code.
//
// Two-stage gate:
//   1. Free, no AI call: reject empty/too-short/too-long/link-spam outright.
//   2. One Anthropic call (Haiku, same cost tier as every other structured
//      content type -- see ai_pipeline/format_prompt.py:CONTENT_TYPE_MODELS)
//      classifies the remainder into publish/hold/reject per the priority
//      order in the Worker Pulse handoff: spam/bot -> reject, harassment/
//      hate -> reject, an unverified defamatory claim about the named
//      employer -> hold for manual review, everything else -> publish.
// On ANY moderation failure (parse error, API error): hold, never publish --
// the opposite of the content-pipeline's usual "fall back to a plain
// template" pattern, because a failure here must never risk exposing
// unmoderated text, only ever risk a slower publish.
//
// Cost/abuse control: the existing monthly AI budget ledger
// (.ai_budget.json) is a file on the GitHub Actions runner's filesystem --
// unreachable from a stateless Worker, so this endpoint's spend isn't
// tracked against it. A per-IP daily submission cap stands in for that here.
import { neon } from '@neondatabase/serverless';
import { type Env, townFromHostname, sha256Hex, jsonResponse } from './_shared';

const MIN_LEN = 3;
const MAX_LEN = 1000;
const MAX_URLS = 2;
const MAX_COMMENTS_PER_IP_PER_DAY = 5;
const MODEL = 'claude-haiku-4-5-20251001';

type Decision = 'publish' | 'hold' | 'reject';

function stage1Reject(body: string): string | null {
  const trimmed = body.trim();
  if (trimmed.length < MIN_LEN) return 'too short';
  if (trimmed.length > MAX_LEN) return 'too long';
  const urlCount = (trimmed.match(/https?:\/\//gi) ?? []).length;
  if (urlCount > MAX_URLS) return 'too many links';
  return null;
}

async function moderate(
  body: string,
  employerNames: string[],
  apiKey: string,
): Promise<{ decision: Decision; reason: string }> {
  const context = employerNames.length
    ? `This comment was submitted on a page about: ${employerNames.join(', ')}.`
    : 'This comment was submitted on a general comparison page covering several employers.';

  const system = `You moderate reader comments on a local news site's "Worker Pulse" section, which discusses real, named employers (warehouse/logistics companies) based on aggregated review-trend data. ${context}

Classify the comment into exactly one decision:
- "reject": spam, bot-like text, gibberish, advertising, OR harassment/hate speech.
- "hold": makes a specific, unverified factual accusation against a named employer or an individual (e.g. a claim of illegal activity, a specific named manager, a specific unverifiable incident) that can't be confirmed from the comment alone -- held for human review, not published.
- "publish": a genuine, on-topic comment -- including first-person opinions, experiences, or general criticism that isn't a specific unverifiable accusation.

Respond with ONLY a JSON object: {"decision": "publish"|"hold"|"reject", "reason": "<one short sentence>"}. No other text.`;

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 150,
      system,
      messages: [{ role: 'user', content: body }],
    }),
  });

  if (!resp.ok) {
    throw new Error(`Anthropic API error: ${resp.status}`);
  }

  const data = (await resp.json()) as { content?: { type?: string; text?: string }[] };
  const rawText = (data.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('');

  // Trots "Respond with ONLY a JSON object... No other text" ovan lindar
  // Haiku ibland ändå in svaret i ett ```json ... ```-kodblock (bekräftat
  // live -- se git-historiken för den här filen). Strippa ett eventuellt
  // omslutande kodblock innan parsning i stället för att lita blint på
  // instruktionen.
  const fenceMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const text = fenceMatch ? fenceMatch[1] : rawText;

  try {
    const parsed = JSON.parse(text);
    if (parsed.decision === 'publish' || parsed.decision === 'hold' || parsed.decision === 'reject') {
      return { decision: parsed.decision, reason: String(parsed.reason ?? '') };
    }
    return { decision: 'hold', reason: `unrecognized decision value: ${JSON.stringify(parsed)}`.slice(0, 200) };
  } catch {
    return { decision: 'hold', reason: `could not parse moderation response: ${text}`.slice(0, 200) };
  }
}

export async function handleComment(request: Request, env: Env): Promise<Response> {
  const townId = townFromHostname(request.url, env.DEV_TOWN_ID);
  if (townId !== 'moreno_valley_ca') {
    return new Response('Not found', { status: 404 });
  }

  let pageSlug: unknown;
  let body: unknown;
  try {
    const parsed = (await request.json()) as { page_slug?: unknown; body?: unknown };
    pageSlug = parsed.page_slug;
    body = parsed.body;
  } catch {
    return new Response('Bad request', { status: 400 });
  }
  if (typeof pageSlug !== 'string' || typeof body !== 'string' || !pageSlug || !body) {
    return new Response('Bad request', { status: 400 });
  }

  const sql = neon(env.DATABASE_URL);
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const ipHash = await sha256Hex(`${ip}:${env.IP_HASH_SALT}`);

  const recent = (await sql`
    SELECT count(*)::int AS n FROM worker_pulse_comments
     WHERE ip_hash = ${ipHash} AND created_at >= now() - interval '24 hours'
  `) as { n: number }[];
  if ((recent[0]?.n ?? 0) >= MAX_COMMENTS_PER_IP_PER_DAY) {
    return jsonResponse({ status: 'rejected', reason: 'rate limit' }, 429);
  }

  let status: 'published' | 'pending_review' | 'rejected';
  let reason: string;

  const stage1 = stage1Reject(body);
  if (stage1) {
    status = 'rejected';
    reason = stage1;
  } else {
    // Kontext åt modellen: vilken/vilka arbetsgivare handlar sidan om?
    // Ett digest-slug ("workplace-watch-amazon-2026-08") pekar ut EN
    // arbetsgivare; jämförelsesidan ("workplace-watch") handlar om alla.
    const employerSlugMatch = pageSlug.match(/^workplace-watch-([a-z0-9-]+)-\d{4}-\d{2}$/);
    let employerNames: string[] = [];
    if (employerSlugMatch) {
      const rows = (await sql`
        SELECT name FROM employers WHERE town_id = ${townId} AND slug = ${employerSlugMatch[1]}
      `) as { name: string }[];
      employerNames = rows.map((r) => r.name);
    } else {
      const rows = (await sql`
        SELECT name FROM employers WHERE town_id = ${townId} ORDER BY name
      `) as { name: string }[];
      employerNames = rows.map((r) => r.name);
    }

    try {
      const result = await moderate(body, employerNames, env.ANTHROPIC_API_KEY);
      status = result.decision === 'publish' ? 'published' : result.decision === 'reject' ? 'rejected' : 'pending_review';
      reason = result.reason;
    } catch {
      status = 'pending_review';
      reason = 'moderation call failed -- held for manual review';
    }
  }

  await sql`
    INSERT INTO worker_pulse_comments (town_id, page_slug, body, status, moderation_reason, ip_hash)
    VALUES (${townId}, ${pageSlug}, ${body.trim()}, ${status}, ${reason}, ${ipHash})
  `;

  return jsonResponse({ status });
}
