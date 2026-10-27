/** Practical facts for an event or meeting detail page on the UK site (owner 2026-10-27): when, where, cost, how to book or
 *  take part, taken ONLY from the source's own fields (story.meta, source_url). A row is left out when the source had nothing;
 *  nothing is invented. Pure, so it is unit-tested (story-facts.test.ts). */
export interface FactRow { label: string; text: string; href?: string; linkText?: string }

interface FactsInput {
  source_type: string;
  is_recurring_series?: boolean;
  source_url?: string | null;
  meta?: { venue?: string; address?: string; when?: string; recurrence?: string; cost?: string; registration?: string } | null;
}
interface FactsContext {
  /** Already formatted by the page: "Fri 30 October · Time TBC" / "Tue 27 October at 12:30pm". */
  whenText: string;
  /** The source lists no clock time (date only): the page says so and links the original listing. */
  timeUnknown?: boolean;
  /** Series with a real clock time ("6pm"): its own row, since whenText has only the cadence. */
  seriesTime?: string;
}

const isUrl = (s: string | undefined): s is string => !!s && /^https?:\/\//i.test(s.trim());

export function storyFacts(story: FactsInput, ctx: FactsContext): FactRow[] {
  const m = story.meta ?? {};
  const rows: FactRow[] = [];
  const add = (label: string, text: string | undefined | null, href?: string, linkText?: string) => {
    if (text && text.trim()) rows.push({ label, text: text.trim(), href, linkText });
  };

  if (story.source_type === 'meeting') {
    add('When', ctx.whenText);
    add('Where', m.address);
    const agenda = isUrl(m.registration) ? m.registration : story.source_url ?? undefined;
    if (agenda) {
      rows.push({
        label: 'How to take part',
        text: 'The agenda page lists how to attend, follow or comment on the meeting.',
        href: agenda, linkText: 'Open the agenda',
      });
    }
    return rows;
  }

  if (story.source_type === 'event') {
    if (story.is_recurring_series) {
      const rec = (m.recurrence ?? m.when ?? '').replace(/\s+from\s+\d.*$/i, '');
      add('When', rec || ctx.whenText);
      if (ctx.seriesTime && !ctx.timeUnknown) add('Time', ctx.seriesTime);
    } else {
      add('When', ctx.whenText);
      if (m.when && !ctx.whenText.includes(m.when)) add('Dates', m.when);
    }
    add('Where', [m.venue, m.address].filter(Boolean).join(', '));
    add('Cost', m.cost);
    if (ctx.timeUnknown) {
      rows.push({ label: 'Time', text: 'Time not listed, check with the venue.', href: story.source_url ?? undefined, linkText: 'Original listing' });
    }
    if (isUrl(m.registration)) rows.push({ label: 'Book', text: 'Booking or details:', href: m.registration, linkText: 'Open the booking page' });
    else if (m.registration) add('Book', `${m.registration}. Use the link to the original listing below.`);
    return rows;
  }
  return rows;
}
