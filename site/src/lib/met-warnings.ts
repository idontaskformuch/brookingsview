/** Pure helpers for the Met Office weather-warning banner (Glasgow).
 *  The server (server/weather-warnings.ts) and the browser script both use
 *  these, so "is this warning still in force" and "how is its time shown"
 *  have one definition. No Date.now() and no machine timezone: now and the
 *  zone are arguments. */
import { formatClockCompact } from './country-profile';

export type WarningLevel = 'yellow' | 'amber' | 'red';

export interface PublicWarning {
  id: string;
  level: WarningLevel;
  weatherTypes: string[];
  headline: string;
  validFrom: string;
  validTo: string;
  whatToExpect: string[];
  whatShouldIDo: string | null;
  sourceName: string;
  sourceUrl: string;
}

const RANK: Record<WarningLevel, number> = { red: 3, amber: 2, yellow: 1 };

/** Shown only while validToDate is in the future (owner rule 2026-10-23). */
export function isInForce(w: Pick<PublicWarning, 'validTo'>, now: Date): boolean {
  const end = Date.parse(w.validTo);
  return Number.isFinite(end) && end > now.getTime();
}

/** Red first, then amber, then yellow; within a level the one starting first. */
export function sortWarnings<T extends Pick<PublicWarning, 'level' | 'validFrom'>>(list: T[]): T[] {
  return [...list].sort((a, b) => RANK[b.level] - RANK[a.level] || Date.parse(a.validFrom) - Date.parse(b.validFrom));
}

export function levelLabel(level: WarningLevel): string {
  return { yellow: 'Yellow', amber: 'Amber', red: 'Red' }[level];
}

/** ["WIND"] -> "wind"; ["EXTREME_HEAT","WIND"] -> "extreme heat and wind". */
export function weatherTypeText(types: string[]): string {
  const words = types.map((t) => t.toLowerCase().replace(/_/g, ' '));
  if (words.length <= 1) return words[0] ?? 'weather';
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

function dayLabel(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone }).format(d).replace(',', '');
}

/** "Valid from 9pm Sat 24 Oct to 9pm Sun 25 Oct" in the given zone
 *  (Europe/London for Glasgow, so BST/GMT is handled by Intl). */
export function formatValidity(validFrom: string, validTo: string, timeZone: string): string {
  const from = new Date(validFrom);
  const to = new Date(validTo);
  const fromDay = dayLabel(from, timeZone);
  const toDay = dayLabel(to, timeZone);
  const f = formatClockCompact(from, timeZone);
  const t = formatClockCompact(to, timeZone);
  if (fromDay === toDay) return `Valid from ${f} to ${t} on ${fromDay}`;
  return `Valid from ${f} ${fromDay} to ${t} ${toDay}`;
}

/** Break a long text into short paragraphs at sentence ends (each at most `max` characters, a single longer sentence stays
 *  whole). The Met Office "what should I do" text arrives as one block of 800+ characters; /weather/ shows it in paragraphs. */
export function splitParagraphs(text: string, max = 240): string[] {
  const sentences = text.replace(/\s+/g, ' ').trim().match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g)?.map((s) => s.trim()).filter(Boolean) ?? [];
  const out: string[] = [];
  let cur = '';
  for (const s of sentences) {
    if (cur && (cur.length + 1 + s.length) > max) { out.push(cur); cur = s; }
    else cur = cur ? `${cur} ${s}` : s;
  }
  if (cur) out.push(cur);
  return out;
}

/** "Amber warning: wind" -- the one-line name of a warning, used by the compact box and the "Right now" line. */
export function warningName(w: Pick<PublicWarning, 'level' | 'weatherTypes'>): string {
  return `${levelLabel(w.level)} warning: ${weatherTypeText(w.weatherTypes)}`;
}

/** First "what to expect" point, shortened at a word boundary for the one-line box (null if the warning has none). */
export function firstExpectation(w: Pick<PublicWarning, 'whatToExpect'>, max = 90): string | null {
  const t = (w.whatToExpect[0] ?? '').replace(/\s+/g, ' ').trim().replace(/[.;:,]+$/, '');
  if (!t) return null;
  if (t.length <= max) return t;
  const cut = t.slice(0, max).replace(/\s+\S*$/, '');
  return `${cut}…`;
}

/** The warnings after the highest one, as "+1 yellow warning" / "+2 yellow warnings" / "+1 amber warning · +1 yellow warning"
 *  (list already sorted, highest first). Empty string when there is nothing more. */
export function moreWarningsText(rest: Pick<PublicWarning, 'level'>[]): string {
  const order: WarningLevel[] = ['red', 'amber', 'yellow'];
  return order
    .map((lv) => ({ lv, n: rest.filter((w) => w.level === lv).length }))
    .filter((x) => x.n > 0)
    .map((x) => `+${x.n} ${x.lv} warning${x.n === 1 ? '' : 's'}`)
    .join(' · ');
}
