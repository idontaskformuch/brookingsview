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
  'broomfieldview.com': 'broomfield_co',
  'www.broomfieldview.com': 'broomfield_co',
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

const TOWN_TIMEZONES: Record<string, string> = {
  moreno_valley_ca: 'America/Los_Angeles',
  brookings_sd: 'America/Chicago',
  broomfield_co: 'America/Denver',
};

/** IANA timezone for a town_id -- unknown/undefined town_id falls back to
 *  Brookings' zone, same "never guess, pick the documented default"
 *  posture as townFromHostname's own devFallback. */
export function timezoneForTown(townId: string | null): string {
  return (townId && TOWN_TIMEZONES[townId]) ?? 'America/Chicago';
}

/** Current ISO-8601 week slug ("2026-w35") in `timeZone` -- e.g. for
 *  redirecting /this-week/ to its permanent per-week archive URL (see
 *  worker.ts). Deliberately a self-contained duplicate of site/src/lib/
 *  this-week.ts's currentWeekInfo()/isoWeekInfo() (same algorithm,
 *  proven correct by that file's own 23 unit tests) rather than an import
 *  across the Astro/Worker build boundary: this-week.ts transitively
 *  imports lib/db.ts, which calls neon(import.meta.env.DATABASE_URL) at
 *  MODULE LOAD TIME -- a Vite/Astro build-time mechanism this file's own
 *  wrangler bundle doesn't have (the Worker gets DATABASE_URL via its own
 *  `env` bindings instead, a completely different mechanism). Importing
 *  that chain here would either break the Worker's build or silently try
 *  to construct a DB client with an undefined URL at Worker cold-start.
 *  Same "duplicate a small pure function across an incompatible runtime
 *  boundary" tradeoff this codebase already makes for OUTLIER_PRICE_FLOOR/
 *  normalize_venue()/db.ts's own isoWeekSlug() (added for the exact same
 *  circular-import reason). */
/** UTC-midnight Monday (as a bare calendar date, not a real instant) of the
 *  ISO week containing `instant`, evaluated in `timeZone`. Shared by
 *  isoWeekSlugForInstant and previousIsoWeekSlug so there's one place that
 *  knows "how to find this week's Monday," not two. */
function mondayOf(instant: Date, timeZone: string): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const localMidnight = Date.UTC(get('year'), get('month') - 1, get('day'));

  const weekday = new Date(localMidnight).getUTCDay(); // 0=Sun..6=Sat
  const daysSinceMonday = (weekday + 6) % 7;
  return new Date(localMidnight - daysSinceMonday * 86_400_000);
}

/** ISO year/week slug ("2026-w35") for the week whose Monday is `monday`
 *  (a UTC-midnight bare calendar date -- see mondayOf). Nearest-Thursday
 *  algorithm, same as this-week.ts's own isoWeekInfo(). */
function slugFromMonday(monday: Date): string {
  const thursdayAnchor = new Date(monday.getTime());
  const mondayDayNum = (thursdayAnchor.getUTCDay() + 6) % 7;
  thursdayAnchor.setUTCDate(thursdayAnchor.getUTCDate() - mondayDayNum + 3);
  const isoYear = thursdayAnchor.getUTCFullYear();
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const jan4DayNum = (jan4.getUTCDay() + 6) % 7;
  const week1Monday = new Date(jan4.getTime() - jan4DayNum * 86_400_000);
  const isoWeek = Math.round((thursdayAnchor.getTime() - week1Monday.getTime()) / (7 * 86_400_000)) + 1;
  return `${isoYear}-w${String(isoWeek).padStart(2, '0')}`;
}

/** Core, testable version -- takes an explicit instant instead of always
 *  reading the live clock, same split this-week.ts itself makes
 *  (weekInfoForInstant vs. currentWeekInfo) so DST/year-boundary cases can
 *  be asserted deterministically instead of faking the system clock. */
export function isoWeekSlugForInstant(instant: Date, timeZone: string): string {
  return slugFromMonday(mondayOf(instant, timeZone));
}

/** The slug for the week immediately before `slug`. Used as a fallback
 *  target (see worker.ts): the "current" week's static archive page only
 *  exists once the hourly rebuild after this week's Monday-midnight
 *  rollover has run, but the PREVIOUS week's page is always already built
 *  -- it was itself "current" (and therefore in [week].astro's
 *  getStaticPaths()) at some point during its own 7-day span, as long as
 *  the site has been building continuously. Subtracts 7 real days from
 *  the week's own Monday (not from "now"), so this is exact regardless of
 *  which timezone/DST state produced the input slug. */
export function previousIsoWeekSlug(slug: string): string | null {
  const m = /^(\d{4})-w(\d{2})$/.exec(slug);
  if (!m) return null;
  const isoYear = Number(m[1]);
  const isoWeek = Number(m[2]);
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const jan4DayNum = (jan4.getUTCDay() + 6) % 7;
  const week1Monday = new Date(jan4.getTime() - jan4DayNum * 86_400_000);
  const thisMonday = new Date(week1Monday.getTime() + (isoWeek - 1) * 7 * 86_400_000);
  const prevMonday = new Date(thisMonday.getTime() - 7 * 86_400_000);
  return slugFromMonday(prevMonday);
}

/** "Right now" wrapper -- see isoWeekSlugForInstant for the actual algorithm. */
export function currentIsoWeekSlug(timeZone: string): string {
  return isoWeekSlugForInstant(new Date(), timeZone);
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
