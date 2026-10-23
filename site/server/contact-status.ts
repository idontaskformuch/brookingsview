/** GET /api/contact-status -- whether the contact FORM can work on this deployment: it needs both the
 *  Turnstile secret (verification) and the Resend key (notification). Glasgow's /contact keeps the form
 *  hidden and shows the email address until this answers true, so the form switches on by itself once
 *  the secrets are set (`wrangler secret put ... --env glasgow`). Answers only a boolean, never a value. */
import type { Env } from './_shared';

const HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=60' };

export function handleContactStatus(env: Pick<Env, 'RESEND_API_KEY' | 'TURNSTILE_SECRET_KEY'>): Response {
  const available = Boolean(env.RESEND_API_KEY && env.TURNSTILE_SECRET_KEY);
  return new Response(JSON.stringify({ available }), { headers: HEADERS });
}
