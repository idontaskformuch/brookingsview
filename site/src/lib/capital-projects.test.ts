/** lib/capital-projects.ts (Fas 5 source 2). The timelines below are the parser's output for the real pages read 2026-11-20
 *  (tests/fixtures/capital_projects/: Varra Park Hillside Stabilization 4537, 10th at Birch Intersection Improvements 4536,
 *  Broomfield Police Building Expansion 4390), copied from scrapers/parsers/capital_projects.py's parse_timeline_line(). Every edge
 *  case is one of them with the one changed field named in the test (CLAUDE.md rule 15). */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SCRAPE_CRON, SCRAPE_WORKFLOWS } from '../../../cron-dispatcher/src/schedule';
import { ALL_CONFIGS } from './site-config';
import {
  CHECK_FREQUENCY_TEXT, PAGE_H1, cipIndexDescription, cipProjectDescription, exactNameMatch, groupOf, groupProjects, lastChecked, nextMilestone, type CipPhase, type CipProject,
} from './capital-projects';
import { PAGE_META_PATTERNS } from '../config/page-meta';
import { fitDescription } from './meta-description';

const ph = (text: string, label: string | null, start: string | null, end: string | null, completed = false, tbd = false): CipPhase =>
  ({ text, label, start, end, completed, tbd });

const VARRA: CipProject = {
  slug: 'varra-park-hillside-stabilization', title: 'Varra Park Hillside Stabilization', description: '',
  source_url: 'https://www.broomfield.org/4537/104107/Varra-Park-Hillside-Stabilization?activeLiveTab=widgets#liveEditTab_widgets',
  timeline: [
    ph('Data Gathering and Geotechnical Field Work: May - June2026', 'Data Gathering and Geotechnical Field Work', '2026-05-01', '2026-06-30'),
    ph('Preliminary Design: July - October 2026 (Completed)', 'Preliminary Design', '2026-07-01', '2026-10-31', true),
    ph('Final Design: November - January 2027', 'Final Design', '2026-11-01', '2027-01-31'),
    ph('Construction: TBD', 'Construction', null, null, false, true),
  ],
  cost_text: null, last_checked_at: '2026-11-20T11:03:00.000Z', delisted_at: null,
};
const BIRCH: CipProject = {
  slug: '10th-at-birch-intersection-improvements', title: '10th at Birch Intersection Improvements',
  description: 'The 10th Avenue at Birch Street intersection improvements project aims to improve safety around the Birch Elementary School.',
  source_url: 'https://www.broomfield.org/4536/10th-at-Birch-Intersection-Improvements',
  timeline: [
    ph('Final Design: May - September 2026', 'Final Design', '2026-05-01', '2026-09-30'),
    ph('Utility Coordination and Relocation: July 2026 - April 2027', 'Utility Coordination and Relocation', '2026-07-01', '2027-04-30'),
    ph('Winter 2026: The budget, scope, prioritization and timing of the project are being re-evaluated due to the planned closure of Birch Elementary School.', null, null, null),
  ],
  cost_text: null, last_checked_at: '2026-11-20T11:02:00.000Z', delisted_at: null,
};
const POLICE: CipProject = {
  slug: 'broomfield-police-building-expansion', title: 'Broomfield Police Building Expansion', description: '',
  source_url: 'https://www.broomfield.org/4390/Broomfield-Police-Building-Expansion',
  timeline: [ph('Construction is anticipated to start in Summer 2026 and take approximately 20 months to complete.', null, null, null)],
  cost_text: 'The project is anticipated to cost $81.6M.', last_checked_at: '2026-11-20T11:01:00.000Z', delisted_at: null,
};
const TODAY = new Date('2026-11-20T12:00:00Z');

describe('groups (a sort order, owner addition 2)', () => {
  it('a phase under way today: in progress', () => {
    expect(groupOf(VARRA, TODAY)).toBe('in_progress');
    expect(groupOf(BIRCH, TODAY)).toBe('in_progress');
  });
  it('every dated phase still ahead: planned (Birch on 2026-04-01, the changed thing is the date)', () => {
    expect(groupOf(BIRCH, new Date('2026-04-01T12:00:00Z'))).toBe('planned');
    // A phase the City marked "(Completed)" means the project has started, whatever its dates say.
    expect(groupOf(VARRA, new Date('2026-04-01T12:00:00Z'))).toBe('in_progress');
  });
  it('every end date passed without "(Completed)": stays in progress, never complete (Birch on 2027-06-01)', () => {
    expect(groupOf(BIRCH, new Date('2027-06-01T12:00:00Z'))).toBe('in_progress');
  });
  it('complete only when the City marks every phase "(Completed)" (Varra with all four marked, the changed field)', () => {
    const done = { ...VARRA, timeline: VARRA.timeline!.filter((p) => !p.tbd).map((p) => ({ ...p, completed: true })) };
    expect(groupOf(done, TODAY)).toBe('complete');
    expect(groupOf({ ...VARRA, timeline: VARRA.timeline!.map((p) => ({ ...p, completed: !p.tbd })) }, TODAY)).toBe('in_progress');
  });
  it('no line with readable dates: "Timeline: see the City\'s page" (decision C)', () => {
    expect(groupOf(POLICE, TODAY)).toBe('see_city');
    expect(groupOf({ ...POLICE, timeline: null }, TODAY)).toBe('see_city');
  });
  it('left the list: its own group, whatever the timeline says', () => {
    expect(groupOf({ ...VARRA, delisted_at: '2026-11-21T11:00:00.000Z' }, TODAY)).toBe('delisted');
  });
});

describe('sorted by the next milestone', () => {
  it('Varra: Final Design ends 2027-01-31; Birch: Utility Coordination ends 2027-04-30', () => {
    expect(nextMilestone(VARRA, TODAY)?.date).toBe('2027-01-31');
    expect(nextMilestone(BIRCH, TODAY)?.date).toBe('2027-04-30');
    expect(nextMilestone(POLICE, TODAY)).toBeNull();
    const groups = groupProjects([BIRCH, POLICE, VARRA], TODAY);
    expect(groups.map((g) => [g.key, g.projects.map((p) => p.slug)])).toEqual([
      ['in_progress', ['varra-park-hillside-stabilization', '10th-at-birch-intersection-improvements']],
      ['see_city', ['broomfield-police-building-expansion']],
    ]);
  });
  it('last checked is the newest successful read', () => {
    expect(lastChecked([BIRCH, POLICE, VARRA])).toBe('2026-11-20T11:03:00.000Z');
    expect(lastChecked([{ last_checked_at: null }])).toBeNull();
  });
});

describe('decision D: cross-link only on an exact name', () => {
  it('exact title only', () => {
    const registry = [{ slug: 'palisade-park-chipotle-mexican-grill', title: 'Palisade Park Chipotle Mexican Grill' }];
    expect(exactNameMatch('Palisade Park Chipotle Mexican Grill', registry)?.slug).toBe('palisade-park-chipotle-mexican-grill');
    expect(exactNameMatch('Palisade Park Chipotle', registry)).toBeNull();
    expect(exactNameMatch('palisade park chipotle mexican grill', registry)).toBeNull();
  });
});

describe('config, schedule and gating', () => {
  const pyConfig = JSON.parse(readFileSync(new URL('../../../configs/broomfield_co.json', import.meta.url), 'utf8'));
  const source = pyConfig.data_sources.capital_projects;

  it('"We check it once a day." matches the real schedule: one of the scrape cron hours, Broomfield\'s scrape workflow', () => {
    const cronHours = SCRAPE_CRON.split(' ')[1].split(',').map(Number);
    expect(SCRAPE_WORKFLOWS).toContain('broomfield-scrape.yml');
    expect(source.run_at_utc_hours).toEqual([11]);
    expect(cronHours).toContain(11);
    expect(source.refresh_minutes).toBeGreaterThanOrEqual(12 * 60); // a manual second run the same day is skipped too
    expect(CHECK_FREQUENCY_TEXT).toBe('We check it once a day.');
  });

  it('the site links the same list the scraper reads', () => {
    const broomfield = ALL_CONFIGS.find((c) => c.townId === 'broomfield_co')!;
    expect(broomfield.capitalProjects?.listUrl).toBe(source.list_url);
  });

  it('astro.config.mjs mirrors the towns with capitalProjects (gated page + sitemap)', () => {
    const cfg = readFileSync(new URL('../../astro.config.mjs', import.meta.url), 'utf8');
    const m = cfg.match(/const CAPITAL_PROJECT_TOWNS = (\[[^\]]*\]);/);
    expect(m).not.toBeNull();
    const towns = ALL_CONFIGS.filter((c) => c.capitalProjects).map((c) => c.townId).sort();
    expect((Function(`return ${m![1]}`)() as string[]).sort()).toEqual(towns);
    const gated = cfg.match(/\{ path: '\/projects\/', activeFor: (\[[^\]]*\]) \}/);
    expect(gated).not.toBeNull();
    expect((Function(`return ${gated![1]}`)() as string[]).sort()).toEqual(towns);
  });

  it('the H1 is the owner\'s wording', () => {
    expect(PAGE_META_PATTERNS.projects.h1Pattern).toBe(PAGE_H1);
    expect(PAGE_H1).toBe('Ongoing capital projects (per the City)');
  });
});

describe('meta descriptions (2026-11-20 battery: /projects/ and long-titled pages were cut with "…")', () => {
  // Every title the first live run (11:00 UTC 2026-11-20) wrote for Broomfield, verbatim from projects (source_type 'cip_page').
  const TITLES = ['10th at Birch Intersection Improvements', '112th & Uptown Avenue Street Improvements',
    '120th Ave Complete Street Improvements', '2026 ADA Curb Ramp Program', 'Airport Creek Trail Underpass',
    'Anthem Community Park Improvements', 'Arista Neighborhood Public Lighting and Electrical System Repairs',
    'Broadlands West Park Retaining Wall Replacement', 'Broomfield Heights Stormwater and Pedestrian Improvements',
    'Broomfield Police Building Expansion', 'CO 7 Interim Bus Stops', 'CO-7 Interim Improvements', 'City Park Channel at Main Street',
    'County Commons Teen Space', 'Kohl St & Daphne St Multimodal Improvements', 'Markel and Wottge Open Space Plan',
    'Mesa Zone Booster Station', 'Midway Boulevard Design', 'Nickel Street and Industrial Lane Intersection Improvements',
    'Nissen Channel', 'North Area Water Tanks', 'Parking Lot Renovations', 'Redpoint Ridge Park Landscape Renovation',
    'Sewer Lift Station Compliance', 'Stoneybrook Drive Retaining Wall Replacement', 'The Field Open Space Overlook Project',
    'Varra Park Hillside Stabilization'];
  const whole = (d: string) => d.length <= 160 && d.endsWith('.') && fitDescription(d) === d;

  it('the list page ends on a whole sentence for every town', () => {
    for (const c of Object.values(ALL_CONFIGS)) expect(whole(cipIndexDescription(c.cityName)), c.cityName).toBe(true);
  });
  it('every real project page names its project and ends on a whole sentence, the longest title included', () => {
    for (const t of TITLES) {
      const d = cipProjectDescription(t, 'Broomfield');
      expect(whole(d), d).toBe(true);
      expect(d.startsWith(`${t}:`), d).toBe(true);
    }
  });
});
