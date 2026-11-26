/** Rules for the "How do I..." answer pages (Fas 3). Pure, so every rule is tested in city-answers.test.ts. */
import type { Answer, AnswerBlock, AnswerPage, Inline } from '../config/city-answers/types';
import { facilityMeta, facilityTitle } from './answer-facility';

/** An answer whose sources were read more than this many days ago is shown as unconfirmed (owner 2026-11-19). */
export const UNCONFIRMED_AFTER_DAYS = 120;

const dayNum = (ymd: string) => Date.parse(`${ymd}T00:00:00Z`) / 86_400_000;

/** The town's calendar date (YYYY-MM-DD) at `now`. */
export function todayIn(tz: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export type AnswerStatus = 'confirmed' | 'unconfirmed';
/** Confirmed while the source says what we show and the read is at most UNCONFIRMED_AFTER_DAYS old. */
export function answerStatus(a: Pick<Answer, 'checked' | 'unconfirmed'>, today: string): AnswerStatus {
  if (a.unconfirmed) return 'unconfirmed';
  return dayNum(today) - dayNum(a.checked) > UNCONFIRMED_AFTER_DAYS ? 'unconfirmed' : 'confirmed';
}

/** One line per answer whose checkAt date has passed: the build prints these as warnings (never fails on them). */
export function checkAtWarnings(pages: AnswerPage[], today: string, townId: string): string[] {
  return pages.flatMap((p) => p.answers.filter((a) => a.checkAt < today).map((a) => `[city-answers] ${townId} /${p.slug}/#${a.id}: checkAt ${a.checkAt} has passed (checked ${a.checked}); read the sources again`));
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** **bold** and [text](href) only; everything else is escaped. External links get rel="noopener". */
export function inlineHtml(text: Inline): string {
  return esc(text)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, t: string, href: string) => `<a href="${href}"${/^https?:/i.test(href.replace(/&amp;/g, '&')) ? ' rel="noopener"' : ''}>${t}</a>`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

/** Plain text of inline markup (for JSON-LD). */
export function inlineText(text: Inline): string {
  return text.replace(/\[([^\]]+)\]\([^)\s]+\)/g, '$1').replace(/\*\*([^*]+)\*\*/g, '$1');
}

/** Dated lines still to come (date >= today). */
export function upcomingDated(items: { date: string; text: Inline }[], today: string): { date: string; text: Inline }[] {
  return items.filter((i) => i.date >= today);
}

/** The season text for today: `during` through `to`, `after` from the day after. */
export function seasonText(b: Extract<AnswerBlock, { kind: 'season' }>, today: string): Inline {
  return today <= b.to ? b.during : b.after;
}

/** The page's <title> and meta description. A page with a `facility` gets both made from it (lib/answer-facility.ts: the year is the town's
 *  today's, so a build in January says the new year); any other page its hand-written `title` (with `{Site}` filled in) and `description`. */
export function answerMeta(page: AnswerPage, o: { siteName: string; town: string; today: string; country?: 'us' | 'gb' }): { title: string; description: string } {
  if (page.facility) {
    return { title: facilityTitle(page.facility, o.town, o.today.slice(0, 4)), description: facilityMeta(page.facility, o.today, o.country ?? 'us') };
  }
  return { title: (page.title ?? '').replace('{Site}', o.siteName), description: page.description ?? '' };
}

/** FAQPage JSON-LD for a hub or a page: confirmed answers with a `faq` sentence only (owner: never for unconfirmed). Null when none. */
export function faqJsonLd(answers: Answer[], today: string): Record<string, unknown> | null {
  const qa = answers.filter((a) => a.faq && answerStatus(a, today) === 'confirmed');
  if (qa.length === 0) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: qa.map((a) => ({ '@type': 'Question', name: a.question, acceptedAnswer: { '@type': 'Answer', text: inlineText(a.faq!) } })),
  };
}
