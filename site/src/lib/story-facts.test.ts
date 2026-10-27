import { describe, it, expect } from 'vitest';
import { storyFacts } from './story-facts';

describe('storyFacts', () => {
  it('meeting: when, where, agenda link with how to take part', () => {
    const rows = storyFacts(
      { source_type: 'meeting', source_url: 'https://x.example/a', meta: { address: 'Council Chamber, City Chambers', registration: 'https://x.example/agenda', venue: 'Planning Applications Committee' } },
      { whenText: 'Tue 27 October at 12:30pm' },
    );
    expect(rows.map((r) => r.label)).toEqual(['When', 'Where', 'How to take part']);
    expect(rows[1].text).toBe('Council Chamber, City Chambers');
    expect(rows[2].href).toBe('https://x.example/agenda');
  });
  it('meeting: falls back to the source link and leaves out a missing place', () => {
    const rows = storyFacts({ source_type: 'meeting', source_url: 'https://x.example/a', meta: {} }, { whenText: 'Tue 27 October' });
    expect(rows.map((r) => r.label)).toEqual(['When', 'How to take part']);
    expect(rows[1].href).toBe('https://x.example/a');
  });
  it('series: recurrence text without the start-from clause, time to be confirmed', () => {
    const rows = storyFacts(
      { source_type: 'event', is_recurring_series: true, meta: { recurrence: 'Every week on Thursday from 27th Nov 2025', venue: 'Kelvin Hall', cost: 'Free' } },
      { whenText: 'Weekly · Thu', timeUnknown: true },
    );
    expect(rows[0].text).toBe('Every week on Thursday');
    expect(rows.map((r) => r.label)).toEqual(['When', 'Where', 'Cost', 'Time']);
    expect(rows[3]).toMatchObject({ text: 'Time not listed, check with the venue.' });
    const timed = storyFacts({ source_type: 'event', is_recurring_series: true, meta: { recurrence: 'Every week on Tuesday' } }, { whenText: '', seriesTime: '6:00pm' });
    expect(timed.map((r) => [r.label, r.text])).toEqual([['When', 'Every week on Tuesday'], ['Time', '6:00pm']]);
  });
  it('event: dates, venue, cost, non-URL booking text, nothing invented', () => {
    const rows = storyFacts(
      { source_type: 'event', meta: { when: '30 October to 1 November 2026', venue: 'Tramway', cost: '£18 / £12 concession', registration: 'Buy tickets now' } },
      { whenText: 'Fri 30 October', timeUnknown: true },
    );
    expect(rows.map((r) => r.label)).toEqual(['When', 'Dates', 'Where', 'Cost', 'Time', 'Book']);
    expect(rows[4].href).toBeUndefined();
    const withLink = storyFacts({ source_type: 'event', source_url: 'https://x.example/e', meta: {} }, { whenText: 'Fri 30 October', timeUnknown: true });
    expect(withLink.find((r) => r.label === 'Time')).toMatchObject({ href: 'https://x.example/e' });
    expect(storyFacts({ source_type: 'event', meta: null }, { whenText: '' })).toEqual([]);
  });
});
