// Broomfield AdSense plan F4 (2026-11-11): /traffic/ was indexable with only an H1 and a source line when the feed had nothing.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { trafficPageState } from './traffic-verdict';
import { ALL_CONFIGS } from './site-config';

describe('trafficPageState', () => {
  it('zero incidents: noindex, and one plain line with the time of the latest read', () => {
    const s = trafficPageState(0, 'Broomfield', 'Nov 11, 4:02 AM MST');
    expect(s.noindex).toBe(true);
    expect(s.statusLine).toBe('No crashes or closures reported on state highways in or near Broomfield as of Nov 11, 4:02 AM MST.');
  });

  it('zero incidents and no successful read: still noindex, and the line claims no time', () => {
    expect(trafficPageState(0, 'Broomfield', null)).toEqual({ noindex: true, statusLine: 'No crashes or closures reported on state highways in or near Broomfield.' });
  });

  it('incidents: indexable with no status line, unless the town keeps the section quiet', () => {
    expect(trafficPageState(2, 'Broomfield', 'Nov 11, 4:02 AM MST')).toEqual({ noindex: false, statusLine: null });
    expect(trafficPageState(2, 'Brookings', null, true).noindex).toBe(true);
  });

  it('the page takes noindex from this state, and shows no section rule, filters or source line without incidents', () => {
    const page = readFileSync(join(__dirname, '../pages/[traffic].astro'), 'utf8');
    expect(page).toContain('noindex={pageState.noindex}');
    expect(page).toMatch(/\{incidents\.length > 0 && <SectionRule/);
    expect(page).toMatch(/\{siteConfig\.trafficSource && incidents\.length > 0 && \(\s*<p class="source">/);
  });

  it('the source scope notes shown on the page use real punctuation, not " -- "', () => {
    for (const c of ALL_CONFIGS) if (c.trafficSource) expect(c.trafficSource.scopeNote, c.townId).not.toContain('--');
  });
});
