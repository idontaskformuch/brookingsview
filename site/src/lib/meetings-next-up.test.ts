import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// Owner 2026-11-25 (Tillägg A: display numbers only for real measurements): /city-hall/'s "Next up" is no hero. It is the same MeetingCard
// as every meeting in every town: organ, a heading with date and time, then "in 5 days" (browser, Fas 3) and the place.
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

describe('/city-hall/ Next up', () => {
  const upcoming = read('../components/meetings/MeetingsUpcoming.astro');
  const card = read('../components/meetings/MeetingCard.astro');
  it('has no HeroStat and renders the next meeting as a plain MeetingCard', () => {
    expect(upcoming).not.toContain('HeroStat');
    expect(upcoming).toMatch(/<div class="up__next">\s*<MeetingCard m=\{next\}/);
    expect(card).not.toMatch(/\bbare\b/);
  });
  it('the card prints the date once (in its heading); the relative words are an empty, hidden span the browser fills', () => {
    expect(card.match(/\{m\.dateLabel\}/g)).toHaveLength(1);
    expect(card).toContain('<span class="mtg__rel" data-rel-day={m.ymd} hidden></span>');
  });
});
