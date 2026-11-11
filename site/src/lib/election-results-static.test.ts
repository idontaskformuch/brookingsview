import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { staticMetaLine, staticView, type ResultsPayload } from './election-results';

// GEO spec punkt 2: crawlers do not run JS, so the raw HTML of /election-results/ must say what the
// page is and where the official numbers are, never "Results will appear after polls close" (false once polls close).
describe('election-results static fallback', () => {
  const src = readFileSync(new URL('../pages/election-results.astro', import.meta.url), 'utf8');
  it('does not promise future results in the server-rendered status', () => {
    expect(src).not.toMatch(/will appear after polls close/);
  });
  it('renders the numbers in the HTML and names the official source in the noscript text', () => {
    expect(src).toMatch(/shown\?\.contests\?\.map/);
    expect(src).toMatch(/<noscript>.*results\.source_name/);
  });
});

const payload = (phase: ResultsPayload['phase'], contests = true): ResultsPayload => ({
  available: true, town: 'broomfield_co', electionDate: '2026-11-03', phase, unofficial: true,
  sourceUpdatedAt: '11/10/2026 5:52:25 PM MST', fetchedAt: '2026-11-11T02:00:51.683Z',
  contests: contests ? [{ id: '20', name: 'United States Senator', choices: [{ name: 'A', votes: 3, pct: 75 }, { name: 'B', votes: 1, pct: 25 }] }] : [],
});

// F5 (Broomfield AdSense audit 2026-11-11): /election-results/ still said "Live results ... change as counting
// continues" eight days after the election, and its About box was a heading with nothing under it.
describe('after election night the page is frozen (owner B4, 2026-11-11)', () => {
  for (const phase of ['after', 'done'] as const) {
    it(`${phase}: numbers in the HTML, no "Live", no "counting continues", no polling`, () => {
      const v = staticView(payload(phase), 'Colorado Secretary of State', 'Broomfield View');
      expect(v.showNumbers).toBe(true);
      expect(v.poll).toBe(false);
      expect(v.text).not.toMatch(/\blive\b/i);
      expect(v.text).not.toMatch(/counting continues/i);
    });
  }
  it('election night still polls and may say live', () => {
    const v = staticView(payload('night'), 'Colorado Secretary of State', 'Broomfield View');
    expect(v.poll).toBe(true);
    expect(v.text).toMatch(/Live results/);
  });
  it('no validated numbers after the night: says so, links the source, no numbers', () => {
    const v = staticView(payload('after', false), 'S', 'Site');
    expect(v).toMatchObject({ poll: false, showNumbers: false });
    expect(v.text).not.toMatch(/\blive\b|counting continues/i);
  });
  it('link-only town: never copies numbers', () => {
    expect(staticView(null, 'Riverside County', 'Moreno Valley View')).toMatchObject({ poll: false, showNumbers: false });
  });
  it('the About box always has a paragraph, not only the optional notice', () => {
    const src = readFileSync(new URL('../pages/election-results.astro', import.meta.url), 'utf8');
    const about = src.slice(src.indexOf('<AboutThisPage'), src.indexOf('</AboutThisPage>'));
    expect(about).toMatch(/\n\s*<p>\{results\.live/);
  });
});

describe('staticMetaLine', () => {
  it('Broomfield: the source stamp once, then turnout; no repeated "Unofficial results"', () => {
    const p = { ...payload('after'), turnout: { ballotsCounted: 40916, registered: 57682 } };
    expect(staticMetaLine(p, 'America/Denver')).toBe('Last updated by the source Nov 10, 5:52 PM MT · 40,916 ballots counted · 57,682 registered voters');
  });
  it('no source stamp: the time we read the numbers, then precincts', () => {
    const p = { ...payload('after'), town: 'brookings_sd', sourceUpdatedAt: null, fetchedAt: '2026-11-11T13:00:45.811Z', precincts: { reported: 671, total: 671 } };
    expect(staticMetaLine(p, 'America/Chicago')).toBe('Numbers as read Nov 11, 7:00 AM CST · 671 of 671 precincts reporting');
  });
});
