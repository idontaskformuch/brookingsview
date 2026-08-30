// POST /api/contact -- the real form behind /contact (previously a mailto:
// link only, no server-side path at all). Cloudflare Turnstile gates
// submission (bot/spam defense); the message is durably stored in
// `contact_messages` regardless of whether outbound email notification
// succeeds, so nothing is lost if RESEND_API_KEY is unset or Resend's API
// call fails -- email is a best-effort convenience, not the source of truth.
//
// Same runtime/routing situation as comment.ts (see that file's own
// docstring): this runs inside worker.ts, the single Worker entry Cloudflare
// actually invokes in production.
import { neon } from '@neondatabase/serverless';
import { type Env, townFromHostname, sha256Hex, jsonResponse, TOWN_SEND_DOMAIN } from './_shared';

const MAX_MESSAGE_LEN = 4000;
const MIN_MESSAGE_LEN = 3;
const MAX_MESSAGES_PER_IP_PER_DAY = 5;

async function verifyTurnstile(token: string, secret: string, ip: string): Promise<boolean> {
  const form = new FormData();
  form.append('secret', secret);
  form.append('response', token);
  form.append('remoteip', ip);

  try {
    const resp = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: form,
    });
    const data = (await resp.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    // Fail-safe on Cloudflare's own verification endpoint erroring: same
    // "on any moderation-adjacent failure, don't publish/accept" posture
    // comment.ts uses for its own AI moderation call.
    return false;
  }
}

async function sendNotificationEmail(
  townId: string, to: string, name: string | null, email: string | null, message: string, apiKey: string,
): Promise<'sent' | 'failed'> {
  const sendDomain = TOWN_SEND_DOMAIN[townId];
  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        from: `Contact form <contact@${sendDomain}>`,
        to: [to],
        reply_to: email || undefined,
        subject: `New contact form message${name ? ` from ${name}` : ''}`,
        text: message,
      }),
    });
    return resp.ok ? 'sent' : 'failed';
  } catch {
    return 'failed';
  }
}

export async function handleContact(request: Request, env: Env): Promise<Response> {
  const townId = townFromHostname(request.url, env.DEV_TOWN_ID);
  if (!townId) {
    return new Response('Not found', { status: 404 });
  }

  let name: unknown, email: unknown, message: unknown, turnstileToken: unknown;
  try {
    const parsed = (await request.json()) as {
      name?: unknown; email?: unknown; message?: unknown; turnstile_token?: unknown;
    };
    name = parsed.name;
    email = parsed.email;
    message = parsed.message;
    turnstileToken = parsed.turnstile_token;
  } catch {
    return new Response('Bad request', { status: 400 });
  }

  if (typeof message !== 'string' || message.trim().length < MIN_MESSAGE_LEN || message.length > MAX_MESSAGE_LEN) {
    return jsonResponse({ status: 'rejected', reason: 'invalid message' }, 400);
  }
  if (typeof turnstileToken !== 'string' || !turnstileToken) {
    return jsonResponse({ status: 'rejected', reason: 'missing verification token' }, 400);
  }
  const cleanName = typeof name === 'string' && name.trim() ? name.trim().slice(0, 200) : null;
  const cleanEmail = typeof email === 'string' && email.trim() ? email.trim().slice(0, 320) : null;

  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';

  const verified = await verifyTurnstile(turnstileToken, env.TURNSTILE_SECRET_KEY, ip);
  if (!verified) {
    return jsonResponse({ status: 'rejected', reason: 'verification failed' }, 400);
  }

  const sql = neon(env.DATABASE_URL);
  const ipHash = await sha256Hex(`${ip}:${env.IP_HASH_SALT}`);

  const recent = (await sql`
    SELECT count(*)::int AS n FROM contact_messages
     WHERE ip_hash = ${ipHash} AND created_at >= now() - interval '24 hours'
  `) as { n: number }[];
  if ((recent[0]?.n ?? 0) >= MAX_MESSAGES_PER_IP_PER_DAY) {
    return jsonResponse({ status: 'rejected', reason: 'rate limit' }, 429);
  }

  const emailStatus = env.RESEND_API_KEY
    ? await sendNotificationEmail(townId, env.CONTACT_TO_ADDRESS, cleanName, cleanEmail, message.trim(), env.RESEND_API_KEY)
    : 'skipped';

  await sql`
    INSERT INTO contact_messages (town_id, name, email, message, ip_hash, email_status)
    VALUES (${townId}, ${cleanName}, ${cleanEmail}, ${message.trim()}, ${ipHash}, ${emailStatus})
  `;

  return jsonResponse({ status: 'ok' });
}
