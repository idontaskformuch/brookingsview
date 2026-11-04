import { describe, expect, it } from 'vitest';
import { ELECTION_BY_TOWN } from '../config/election';
import { buildResultsBanner } from './election';
import { updateResultsBanner } from './election-banner';

const at = (iso: string) => new Date(iso);

describe('buildResultsBanner window', () => {
  const bf = ELECTION_BY_TOWN.broomfield_co;
  it('is hidden before Election Day, shown on it, and gone 7 days after (local midnight)', () => {
    expect(buildResultsBanner(bf, 'America/Denver', at('2026-11-02T20:00:00Z'))!.visible).toBe(false);
    expect(buildResultsBanner(bf, 'America/Denver', at('2026-11-03T08:00:00Z'))!.visible).toBe(true); // 01:00 MST Nov 3
    expect(buildResultsBanner(bf, 'America/Denver', at('2026-11-11T06:59:00Z'))!.visible).toBe(true); // 23:59 MST Nov 10
    expect(buildResultsBanner(bf, 'America/Denver', at('2026-11-11T07:00:00Z'))!.visible).toBe(false); // Nov 11 00:00 MST
  });
  it('the window is read in each site timezone, not the visitors (CT, MT, PT)', () => {
    // until 2026-11-10 inclusive = local midnight into Nov 11 (standard time: CST UTC-6, MST UTC-7, PST UTC-8)
    for (const [id, tz, endUtc] of [['brookings_sd', 'America/Chicago', '2026-11-11T06:00:00.000Z'], ['broomfield_co', 'America/Denver', '2026-11-11T07:00:00.000Z'], ['moreno_valley_ca', 'America/Los_Angeles', '2026-11-11T08:00:00.000Z']] as const) {
      const b = buildResultsBanner(ELECTION_BY_TOWN[id], tz, at('2026-11-05T00:00:00Z'))!;
      expect(b.showUntil).toBe(endUtc);
      expect(buildResultsBanner(ELECTION_BY_TOWN[id], tz, new Date(Date.parse(endUtc) - 60_000))!.visible).toBe(true);
      expect(buildResultsBanner(ELECTION_BY_TOWN[id], tz, new Date(endUtc))!.visible).toBe(false);
    }
  });
  it('a build after the window ships no card (expired), a build before it does (hidden)', () => {
    const bf = ELECTION_BY_TOWN.broomfield_co;
    expect(buildResultsBanner(bf, 'America/Denver', at('2026-11-11T07:00:00Z'))!.expired).toBe(true);
    expect(buildResultsBanner(bf, 'America/Denver', at('2026-11-11T06:59:00Z'))!.expired).toBe(false);
    const early = buildResultsBanner(bf, 'America/Denver', at('2026-10-30T12:00:00Z'))!;
    expect([early.expired, early.visible]).toEqual([false, false]);
  });
  it('config window ends 7 days after Election Day for every town', () => {
    for (const cfg of Object.values(ELECTION_BY_TOWN)) expect(cfg.results_banner).toEqual({ from: '2026-11-03', until: '2026-11-10' });
  });
  it('has no card for a town without an election block (Glasgow)', () => {
    expect(ELECTION_BY_TOWN.glasgow).toBeUndefined();
  });
});

describe('buildResultsBanner text follows polls closing', () => {
  it('Moreno closes 8 PM: pre-close text, then results text', () => {
    const mv = ELECTION_BY_TOWN.moreno_valley_ca;
    expect(buildResultsBanner(mv, 'America/Los_Angeles', at('2026-11-04T03:59:00Z'))!.text).toBe('Election night results — polls close 8 PM');
    expect(buildResultsBanner(mv, 'America/Los_Angeles', at('2026-11-04T04:00:00Z'))!.text).toBe('Election results — where to find the official numbers'); // link-only town
  });
  it('Brookings and Broomfield close 7 PM and say live updates after', () => {
    for (const [id, tz] of [['brookings_sd', 'America/Chicago'], ['broomfield_co', 'America/Denver']] as const) {
      const b = buildResultsBanner(ELECTION_BY_TOWN[id], tz, at('2026-11-03T12:00:00Z'))!;
      expect(b.before).toBe('Election night results — polls close 7 PM');
      expect(b.after).toBe('Election results — live updates');
      expect(b.href).toBe('/election-results/');
    }
  });
});

describe('updateResultsBanner (browser re-check)', () => {
  const el = (b: ReturnType<typeof buildResultsBanner>) => {
    const text = { textContent: '' };
    const node: any = { hidden: true, dataset: { showFrom: b!.showFrom, showUntil: b!.showUntil, swapAt: b!.swapAt, before: b!.before, after: b!.after }, querySelector: () => text };
    return { node, text, doc: { querySelectorAll: () => [node] } as unknown as Document };
  };
  const bf = buildResultsBanner(ELECTION_BY_TOWN.broomfield_co, 'America/Denver')!;
  it('shows inside the window with the right text, hides after it', () => {
    const { node, text, doc } = el(bf);
    updateResultsBanner(doc, Date.parse('2026-11-03T20:00:00Z'));
    expect([node.hidden, text.textContent]).toEqual([false, bf.before]);
    updateResultsBanner(doc, Date.parse('2026-11-04T03:00:00Z'));
    expect([node.hidden, text.textContent]).toEqual([false, bf.after]);
    updateResultsBanner(doc, Date.parse('2026-11-11T07:00:00Z'));
    expect(node.hidden).toBe(true);
  });
});
