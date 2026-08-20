// Delade hjälpare för Cloudflare Pages Functions (site/functions/api/*.ts).
// `_`-prefixet gör att Cloudflare INTE routar den här filen som ett eget
// endpoint -- ren delad kod, samma konvention som Cloudflare Pages
// Functions själva definierar.
//
// VIKTIGT: detta är TypeScript som körs i Cloudflare Workers edge-runtime,
// INTE Python -- ai_pipeline/guardrails.py och format_prompt.py (som körs i
// GitHub Actions) går inte att importera härifrån. Se moduldocstringen i
// site/functions/api/comment.ts för varför moderationslogiken är egen kod
// som speglar samma FILOSOFI, inte samma import.

export interface Env {
  DATABASE_URL: string;
  ANTHROPIC_API_KEY: string;
  IP_HASH_SALT: string;
  /** Endast för lokal `wrangler pages dev` där hostname är localhost --
   *  produktionsanrop avgör alltid town_id från det riktiga hostnamnet. */
  DEV_TOWN_ID?: string;
}

const TOWN_HOSTNAMES: Record<string, string> = {
  'morenovalleyview.com': 'moreno_valley_ca',
  'www.morenovalleyview.com': 'moreno_valley_ca',
  'brookingsview.com': 'brookings_sd',
  'www.brookingsview.com': 'brookings_sd',
};

/** town_id från requestens hostname. Okänt hostname (localhost,
 *  *.pages.dev-förhandsgranskning) -> devFallback i stället för att gissa. */
export function townFromHostname(url: string, devFallback?: string): string | null {
  const hostname = new URL(url).hostname;
  return TOWN_HOSTNAMES[hostname] ?? devFallback ?? null;
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Dagens datum SOM STRÄNG i en given tidszon (YYYY-MM-DD), inte via ett
 *  JS Date-objekt -- en Workers-process kör i UTC, så en naiv
 *  new Date().toISOString() skulle klassa en röst avlagd sent på kvällen
 *  Pacific-tid till FEL kalenderdag så fort UTC redan passerat midnatt men
 *  Pacific inte gjort det än. Samma buggklass som period_ym-fixen i
 *  lib/db.ts (Fas 1) -- löst rätt från början här i stället för att
 *  upptäckas i produktion. en-CA-lokalen formaterar direkt som YYYY-MM-DD. */
export function todayInTimezone(tz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
