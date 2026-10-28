import { readFileSync } from 'node:fs';
import { zipSync, strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { inspectCountyElections, parseClarityDetail, parseClaritySummary } from '../src/adapters/clarity';
import { checkBroomfieldCountyFeed, currentVersion, fetchClarity } from '../src/fetch/clarity';
import { validateSnapshot } from '../src/validate';

const dir = new URL('./fixtures/clarity-state-2026-06/', import.meta.url);
const summary = readFileSync(new URL('summary.json', dir), 'utf8');
const detail = readFileSync(new URL('detail.xml', dir), 'utf8');

describe('clarity statewide fixture (Colorado 2026-06-30 primary)', () => {
  const contests = parseClaritySummary(summary);
  it('reads all 197 contests with votes aligned to choices', () => {
    expect(contests).toHaveLength(197);
    const senate = contests.find((c) => c.sourceContestId === '1')!;
    expect(senate.name).toBe('United States Senator - Democratic Party');
    expect(senate.choices).toEqual([{ name: 'Julie Gonzales', votes: 422488 }, { name: 'John Hickenlooper', votes: 472870 }]);
  });
  it('reads source timestamp and Broomfield turnout from detail.xml', () => {
    const d = parseClarityDetail(detail);
    expect(d.timestamp).toBe('7/23/2026 4:21:16 PM MDT');
    expect(d.electionDate).toBe('6/30/2026');
    const bf = d.counties.find((c) => c.county === 'Broomfield')!;
    expect(bf).toMatchObject({ totalVoters: 56478, ballotsCast: 22906, precinctsParticipating: 2, precinctsReported: 2 });
  });
  it('rejects mismatched choices/votes', () => {
    expect(() => parseClaritySummary(JSON.stringify([{ K: '9', C: 'x', CH: ['a'], V: [1, 2] }]))).toThrow(/mismatched/);
  });
  it('passes validation as a first snapshot and fails when a contest vanishes', () => {
    const snap = (cs: typeof contests) => ({
      townId: 'broomfield_co', electionDate: '2026-06-30', sourceUrl: '', sourceUpdatedAt: null,
      fetchedAt: '', precinctsReported: null, precinctsTotal: null, contests: cs,
    });
    expect(validateSnapshot(snap(contests), null, ['1']).valid).toBe(true);
    expect(validateSnapshot(snap(contests.filter((c) => c.sourceContestId !== '1')), snap(contests), ['1']).valid).toBe(false);
  });
});

describe('clarity fetching (mocked network)', () => {
  const zip = zipSync({ 'detail.xml': strToU8(detail) });
  const f = (async (url: string) => {
    if (url.endsWith('current_ver.txt')) return new Response('377440\n');
    if (url.endsWith('summary.json')) return new Response(summary);
    if (url.endsWith('detailxml.zip')) return new Response(zip);
    return new Response('nope', { status: 404 });
  }) as unknown as typeof fetch;
  it('polls the version at event level, then downloads that version', async () => {
    expect(await currentVersion('https://x/CO/126592', f)).toBe('377440');
    const r = await fetchClarity('https://x/CO/126592', f);
    expect(r.version).toBe('377440');
    expect(r.sourceUrl).toBe('https://x/CO/126592/377440/');
    expect(r.contests).toHaveLength(197);
  });
  it('refuses an HTML error page as a version', async () => {
    const bad = (async () => new Response('<html>404</html>')) as unknown as typeof fetch;
    await expect(currentVersion('https://x/CO/1', bad)).rejects.toThrow(/not a version/);
  });
});

describe('Broomfield county feed watcher', () => {
  it('is empty while elections.json is []', async () => {
    const f = (async () => new Response('[]')) as unknown as typeof fetch;
    expect(await checkBroomfieldCountyFeed('2026-11-03', f)).toEqual({ status: 'empty' });
  });
  // The real entry shape has never been observed; these are SYNTHETIC entries, labelled as such.
  it('takes over when an entry names the date and a /CO/Broomfield/<id> path (synthetic shape)', () => {
    const j = JSON.stringify([{ name: '2026 General Election', date: '11/3/2026', link: '/CO/Broomfield/130001/web.400000/' }]);
    expect(inspectCountyElections(j, '2026-11-03')).toEqual({ status: 'ready', base: 'https://results.enr.clarityelections.com/CO/Broomfield/130001' });
  });
  it('asks for review (never guesses) when entries do not match', () => {
    const j = JSON.stringify([{ name: '2025 Coordinated', date: '11/4/2025', link: '/CO/Broomfield/120000/' }]);
    expect(inspectCountyElections(j, '2026-11-03').status).toBe('needs-review');
    expect(inspectCountyElections(JSON.stringify([{ foo: 1 }]), '2026-11-03').status).toBe('needs-review');
  });
});

import { resolveColoradoStateEvent } from '../src/fetch/clarity';
describe('resolveColoradoStateEvent', () => {
  it('reads the event id from the SoS page link', async () => {
    const f = (async () => new Response('<a href="https://results.enr.clarityelections.com/CO/126592/web.345435/#/summary">x</a>')) as unknown as typeof fetch;
    expect(await resolveColoradoStateEvent(f)).toBe('https://results.enr.clarityelections.com/CO/126592');
  });
  it('returns null when the page has no Clarity link', async () => {
    expect(await resolveColoradoStateEvent((async () => new Response('<p>none</p>')) as unknown as typeof fetch)).toBeNull();
  });
});

import { pickStateEvent } from '../src/adapters/clarity';
import { resolveColoradoEventForDate } from '../src/fetch/clarity';
describe('Colorado event discovery by date (owner decision 2026-10-28)', () => {
  const entry = (EID: string, ElectionName: string, Date: string, County = '') => ({ State: 'CO', StateId: '286', County, CountyId: '', EID, ElectionName, Date });
  const june = entry('126592', '2026 Primary', '6/30/2026 12:00:00 AM');
  const nov = entry('130001', '2026 General', '11/3/2026 12:00:00 AM');
  const list = (...e: object[]) => JSON.stringify(e);
  const SOS = '<a href="https://results.enr.clarityelections.com/CO/126592/web.345435/#/summary">x</a>';
  const mk = (stateList: string | Error, sos = SOS) => (async (u: string) => {
    if (String(u).endsWith('/CO/elections.json')) { if (stateList instanceof Error) throw stateList; return new Response(stateList); }
    return new Response(sos);
  }) as unknown as typeof fetch;

  it('matches the event on the election DATE, not its name', () => {
    expect(pickStateEvent(list(june, nov), '2026-11-03')).toEqual({ status: 'found', eid: '130001' });
    expect(pickStateEvent(list(june, { ...nov, ElectionName: 'Anything' }), '2026-11-03')).toMatchObject({ status: 'found' });
  });
  it('reports none (with the known ids) before the November event exists, and ambiguous for two on one date', () => {
    expect(pickStateEvent(list(june), '2026-11-03')).toEqual({ status: 'none', knownEids: ['126592'] });
    expect(pickStateEvent(list(nov, { ...nov, EID: '130002' }), '2026-11-03')).toEqual({ status: 'ambiguous', eids: ['130001', '130002'] });
  });
  it('ignores county-level entries and junk', () => {
    expect(pickStateEvent(list(entry('5', 'x', '11/3/2026 12:00:00 AM', 'Broomfield'), { foo: 1 }), '2026-11-03').status).toBe('none');
  });
  it('finds November in the state list even while the SoS page still links June', async () => {
    expect(await resolveColoradoEventForDate('2026-11-03', mk(list(june, nov)))).toBe('https://results.enr.clarityelections.com/CO/130001');
  });
  it('manual override in config wins over discovery', async () => {
    expect(await resolveColoradoEventForDate('2026-11-03', mk(list(june, nov)), '999')).toBe('https://results.enr.clarityelections.com/CO/999');
  });
  it('no event for the date -> null (option A), and the stale June SoS link is not used', async () => {
    expect(await resolveColoradoEventForDate('2026-11-03', mk(list(june)))).toBeNull();
  });
  it('uses the SoS page when it is not a known event of another date, and when the list is down', async () => {
    const sosNew = '<a href="https://results.enr.clarityelections.com/CO/140000/web.1/#/summary">x</a>';
    expect(await resolveColoradoEventForDate('2026-11-03', mk(list(june), sosNew))).toBe('https://results.enr.clarityelections.com/CO/140000');
    expect(await resolveColoradoEventForDate('2026-11-03', mk(new Error('503')))).toBe('https://results.enr.clarityelections.com/CO/126592');
  });
});
