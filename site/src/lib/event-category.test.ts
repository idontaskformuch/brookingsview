import { describe, expect, it } from 'vitest';
import { categoryOfEvent } from './event-category';

describe('categoryOfEvent', () => {
  it.each([
    ['SDSU Concert Choir Fall Concert', 'music'], ['Library Commission Meeting', 'civic'], ['Toddler Storytime', 'family'],
    ['Farmers Market', 'food'], ['Open Mic Night', 'nightlife'], ['Pottery workshop', 'arts'], ['Jackrabbits vs Bison', 'sports'],
  ])('%s -> %s', (title, cat) => expect(categoryOfEvent(title)).toBe(cat));
  it('no match is null, never a guess', () => {
    expect(categoryOfEvent('Mrs. Doubtfire Outdoor Screening')).toBe('arts');
    expect(categoryOfEvent('Shop for a Cause Fundraiser')).toBeNull();
    expect(categoryOfEvent('Veterans Day')).toBeNull();
  });
  it('uses the source category label when it has one', () => {
    expect(categoryOfEvent('Evening at the hall', 'Music')).toBe('music');
  });
});

describe('categoryOfEvent: "board" and plurals (owner 2026-11-08)', () => {
  it('"board" alone is not civic; a board meeting is', () => {
    expect(categoryOfEvent('Board Games More Games')).toBeNull();
    expect(categoryOfEvent('School Board Meeting')).toBe('civic');
    expect(categoryOfEvent('Board of Supervisors')).toBe('civic');
  });
  it('plurals match like the singular', () => {
    expect(categoryOfEvent('Playwriting workshops with John Binnie')).toBe('arts');
    expect(categoryOfEvent('Summer concerts')).toBe('music');
    expect(categoryOfEvent('Open galleries weekend')).toBe('arts');
  });
  it('tabletop "games" stay neutral', () => {
    expect(categoryOfEvent('Table Top Role Playing Games Club')).toBeNull();
  });
  it('the 26 live Glasgow titles (2026-11-08): neutral 15 of 26 before (58 %), 11 after (42 %): Board Games civic -> neutral, 5 museum/workshop rows -> arts via the plural', async () => {
    const rows = (await import('./fixtures/glasgow-event-titles-2026-11-08.json')).default as Array<{ title: string; category: string | null }>;
    expect(rows).toHaveLength(26);
    const neutral = rows.filter((r) => categoryOfEvent(r.title, r.category) === null).length;
    expect(neutral).toBe(11);
    expect(categoryOfEvent(rows.find((r) => r.title.startsWith('Board Games'))!.title)).toBeNull();
  });
});
