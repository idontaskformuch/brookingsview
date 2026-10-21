/** Torrtest (spec acceptance, phase 2): simulate an election night against the FINISHED June 2026
 *  primaries -- Brookings County (SD XLSX) and Colorado statewide (Clarity, Broomfield turnout) --
 *  with an injected clock and an in-memory store. Covers: no fetching before polls close, 10-minute
 *  cadence through 02:00, twice-a-day after, growth accepted, decrease / changed candidates / zeroed /
 *  empty blocked with the last valid snapshot staying served, source errors storing nothing, unchanged
 *  data not re-stored, and "Unofficial" + times in the public JSON. No rebuild exists to trigger:
 *  the page reads the JSON endpoint, which is exactly what toPublic() feeds. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { toPublic } from '../src/api';
import { parseClaritySummary, parseClarityDetail } from '../src/adapters/clarity';
import { parseSdWorkbook } from '../src/adapters/sd-xlsx';
import { phaseAt, shouldFetch } from '../src/phase';
import { runTown, sha256Hex, type SaveRecord, type Store } from '../src/pipeline';
import type { SourceReading } from '../src/sources';
import type { TownElection } from '../src/towns';
import type { Contest, Snapshot } from '../src/types';

const sdBytes = new Uint8Array(readFileSync(new URL('./fixtures/sd-brookings-2026-06-primary.xlsx', import.meta.url)));
const clSummary = readFileSync(new URL('./fixtures/clarity-state-2026-06/summary.json', import.meta.url), 'utf8');
const clDetail = parseClarityDetail(readFileSync(new URL('./fixtures/clarity-state-2026-06/detail.xml', import.meta.url), 'utf8'));

const BROOKINGS: TownElection = {
  townId: 'brookings_sd', source: { kind: 'sd_xlsx', county: 'Brookings' },
  cadence: { electionDate: '2026-06-02', timezone: 'America/Chicago', startLocal: '19:00', fetchUntil: '2026-06-09' },
};
const BROOMFIELD: TownElection = {
  townId: 'broomfield_co', source: { kind: 'clarity_co', county: 'Broomfield' },
  cadence: { electionDate: '2026-06-30', timezone: 'America/Denver', startLocal: '19:00', fetchUntil: '2026-07-07' },
};

/** Local wall-clock -> Date (CDT = UTC-5, MDT = UTC-6 in June). */
const at = (ymd: string, hhmm: string, utcOffset: number) => new Date(`${ymd}T${hhmm}:00-${String(utcOffset).padStart(2, '0')}:00`);

function memoryStore() {
  const saved: Array<SaveRecord & { n: number }> = [];
  const store: Store = {
    async lastValid(townId, date) {
      const v = [...saved].reverse().find((s) => s.valid && s.reading.snapshot.townId === townId && s.reading.snapshot.electionDate === date);
      return v ? v.reading.snapshot : null;
    },
    async hasHash(townId, date, hash) {
      return saved.some((s) => s.hash === hash && s.reading.snapshot.townId === townId && s.reading.snapshot.electionDate === date);
    },
    async save(rec) { saved.push({ ...rec, n: saved.length }); },
  };
  return { saved, store };
}

const scale = (cs: Contest[], f: number): Contest[] =>
  cs.map((c) => ({ ...c, choices: c.choices.map((ch) => ({ ...ch, votes: Math.floor(ch.votes * f) })) }));

function reading(town: TownElection, contests: Contest[], now: Date, updated: string): SourceReading {
  const snap: Snapshot = {
    townId: town.townId, electionDate: town.cadence.electionDate, sourceUrl: 'https://example.test/results', sourceUpdatedAt: updated,
    fetchedAt: now.toISOString(), precinctsReported: 10, precinctsTotal: 686, contests,
    turnout: town.townId === 'broomfield_co' ? { ballotsCounted: 22906, registered: 56478, precinctsReporting: 2, precinctsTotal: 2 } : undefined,
  };
  return { kind: town.source.kind === 'sd_xlsx' ? 'sd_xlsx' : 'clarity_state', snapshot: snap, raw: new TextEncoder().encode(JSON.stringify(contests)) };
}

describe('cadence (spec 2d) in the town timezone', () => {
  const c = BROOKINGS.cadence;
  it('does not fetch before polls close, fetches every tick until 02:00, then twice a day', () => {
    expect(shouldFetch(at('2026-06-02', '18:50', 5), c)).toBe(false);
    expect(shouldFetch(at('2026-06-02', '19:00', 5), c)).toBe(true);
    expect(shouldFetch(at('2026-06-03', '01:50', 5), c)).toBe(true);
    expect(phaseAt(at('2026-06-03', '02:00', 5), c)).toBe('after');
    expect(shouldFetch(at('2026-06-03', '02:10', 5), c)).toBe(false);
    expect(shouldFetch(at('2026-06-03', '07:00', 5), c)).toBe(true);
    expect(shouldFetch(at('2026-06-03', '07:10', 5), c)).toBe(false);
    expect(shouldFetch(at('2026-06-03', '19:00', 5), c)).toBe(true);
    expect(shouldFetch(at('2026-06-10', '07:00', 5), c)).toBe(false);
    expect(phaseAt(at('2026-06-10', '07:00', 5), c)).toBe('done');
  });
});

describe('simulated election night, Brookings County (June primary data)', () => {
  const base = parseSdWorkbook(sdBytes).contests;
  const scope = base.map((c) => c.sourceContestId);

  it('walks the whole night', async () => {
    const { saved, store } = memoryStore();
    let now = at('2026-06-02', '18:50', 5);
    let next: (() => SourceReading | Error | null) | null = null;
    const deps = {
      now: () => now,
      read: async () => { const r = next!(); if (r instanceof Error) throw r; return r; },
      store,
    };
    const tick = async (hhmm: string, day = '2026-06-02', mk: () => SourceReading | Error | null = () => null) => {
      now = at(day, hhmm, 5); next = mk; return runTown(BROOKINGS, deps);
    };
    const wrap = (cs: Contest[], upd: string) => () => reading(BROOKINGS, cs, now, upd);

    // 18:50: before polls close -> no fetch at all.
    expect(await tick('18:50', '2026-06-02', () => { throw new Error('must not be called'); })).toEqual({ action: 'skipped', reason: 'phase' });
    // 19:00: zeroed early data is blocked (nothing valid yet to show).
    expect(await tick('19:00', '2026-06-02', wrap(scale(base, 0), '7:00 PM CT'))).toMatchObject({ action: 'saved', valid: false });
    expect(await store.lastValid('brookings_sd', '2026-06-02')).toBeNull();
    // 19:10: first real data accepted.
    expect(await tick('19:10', '2026-06-02', wrap(scale(base, 0.3), '7:10 PM CT'))).toMatchObject({ action: 'saved', valid: true });
    // 19:20: identical bytes -> not re-stored.
    expect(await tick('19:20', '2026-06-02', wrap(scale(base, 0.3), '7:10 PM CT'))).toEqual({ action: 'unchanged' });
    // 19:30: growth accepted.
    expect(await tick('19:30', '2026-06-02', wrap(scale(base, 0.6), '7:30 PM CT'))).toMatchObject({ action: 'saved', valid: true });
    // 19:40: a decrease is blocked and flagged; last valid (0.6) stays.
    const dec = await tick('19:40', '2026-06-02', wrap(scale(base, 0.5), '7:40 PM CT'));
    expect(dec).toMatchObject({ action: 'saved', valid: false });
    expect((dec as { problems: string[] }).problems.join()).toMatch(/decreased/);
    // 19:50: source error -> nothing stored.
    const before = saved.length;
    expect(await tick('19:50', '2026-06-02', () => new Error('sd: GET -> 503'))).toMatchObject({ action: 'error' });
    expect(saved.length).toBe(before);
    // 20:00: a changed candidate set is blocked.
    const changed = base.map((c, i) => (i === 0 ? { ...c, choices: [{ name: 'Someone New', votes: 99999 }, ...c.choices.slice(1)] } : c));
    expect(await tick('20:00', '2026-06-02', wrap(scale(changed, 0.9), '8:00 PM CT'))).toMatchObject({ action: 'saved', valid: false });
    // 20:10: a response missing a contest is blocked.
    expect(await tick('20:10', '2026-06-02', wrap(scale(base.slice(1), 0.9), '8:10 PM CT'))).toMatchObject({ action: 'saved', valid: false });
    // 20:20: an empty response is blocked.
    expect(await tick('20:20', '2026-06-02', wrap([], '8:20 PM CT'))).toMatchObject({ action: 'saved', valid: false });
    // 23:50: final numbers accepted.
    expect(await tick('23:50', '2026-06-02', wrap(base, '11:50 PM CT'))).toMatchObject({ action: 'saved', valid: true });
    // 02:10 next day: outside the night window and not a twice-a-day slot -> skipped.
    expect(await tick('02:10', '2026-06-03', wrap(base, 'x'))).toEqual({ action: 'skipped', reason: 'phase' });

    // Public JSON: last valid snapshot, unofficial, both times present, source order kept, pct from votes.
    const last = await store.lastValid('brookings_sd', '2026-06-02');
    const pub = toPublic(BROOKINGS, last, at('2026-06-03', '00:00', 5));
    expect(pub).toMatchObject({ available: true, unofficial: true, phase: 'night', sourceUpdatedAt: '11:50 PM CT' });
    expect(pub.fetchedAt).toBeTruthy();
    const sheriff = pub.contests!.find((c) => c.id === '13297')!;
    expect(sheriff.choices).toEqual([{ name: 'David Biteler', votes: 2506, pct: 68.7 }, { name: 'Shawn Hostler', votes: 1141, pct: 31.3 }]);
    expect(scope.length).toBe(11);
    expect(Object.keys(pub)).not.toContain('winner');
    // Every blocked snapshot kept its reason; raw payloads are all stored (never dropped).
    expect(saved.filter((s) => !s.valid).every((s) => s.problems.length > 0)).toBe(true);
  });
});

describe('simulated election night, Broomfield (Colorado June primary, Clarity)', () => {
  it('stores statewide contests plus Broomfield turnout, and hashes dedupe identical polls', async () => {
    const { saved, store } = memoryStore();
    const contests = parseClaritySummary(clSummary);
    const row = clDetail.counties.find((x) => x.county === 'Broomfield')!;
    expect(row.ballotsCast).toBe(22906);
    let now = at('2026-06-30', '19:30', 6);
    const deps = { now: () => now, read: async () => reading(BROOMFIELD, contests, now, clDetail.timestamp!), store };
    expect(await runTown(BROOMFIELD, deps)).toMatchObject({ action: 'saved', valid: true });
    now = at('2026-06-30', '19:40', 6);
    expect(await runTown(BROOMFIELD, deps)).toEqual({ action: 'unchanged' });
    const pub = toPublic(BROOMFIELD, await store.lastValid('broomfield_co', '2026-06-30'), now);
    expect(pub.turnout).toEqual({ ballotsCounted: 22906, registered: 56478 });
    expect(pub.contests).toHaveLength(197);
    expect(saved).toHaveLength(1);
    expect(await sha256Hex(new TextEncoder().encode('a'))).toHaveLength(64);
  });
});

describe('link-only town (Moreno Valley)', () => {
  it('never fetches', async () => {
    const { store } = memoryStore();
    const town: TownElection = { townId: 'moreno_valley_ca', source: { kind: 'link_only' }, cadence: BROOKINGS.cadence };
    expect(await runTown(town, { now: () => at('2026-06-02', '21:00', 5), read: async () => { throw new Error('no'); }, store })).toEqual({ action: 'skipped', reason: 'link-only' });
  });
});
