import { describe, expect, it } from 'vitest';
import { HEARTBEAT_JOBS, recordHeartbeat, recordHeartbeats, safetyTownResults } from '../src/heartbeat';

const recorder = (fail = false) => {
  const calls: { text: string; values: any[] }[] = [];
  const sql = (async (strings: TemplateStringsArray, ...values: any[]) => {
    calls.push({ text: strings.join('?'), values });
    if (fail) throw new Error('connection refused');
    return [];
  }) as any;
  return { sql, calls };
};

describe('recordHeartbeat', () => {
  it('a success upserts last_ok and nothing about errors', async () => {
    const { sql, calls } = recorder();
    await recordHeartbeat(sql, 'alerts', { townId: 'glasgow', ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].values).toEqual(['glasgow', 'alerts']);
    expect(calls[0].text).toContain('last_ok = now()');
    expect(calls[0].text).not.toContain('last_error');
  });
  it('a failure records last_error / last_error_at and leaves last_ok out of the update', async () => {
    const { sql, calls } = recorder();
    await recordHeartbeat(sql, 'alerts', { townId: 'glasgow', ok: false, error: 'MET_OFFICE_WARNINGS_API_KEY is not set' });
    expect(calls[0].values).toEqual(['glasgow', 'alerts', 'MET_OFFICE_WARNINGS_API_KEY is not set']);
    const update = calls[0].text.split('DO UPDATE SET')[1];
    expect(update).toContain('last_error');
    expect(update).toContain('last_error_at');
    expect(update).not.toContain('last_ok');
  });
  it('truncates a long error to 500 characters', async () => {
    const { sql, calls } = recorder();
    await recordHeartbeat(sql, 'safety', { townId: 'broomfield_co', ok: false, error: 'x'.repeat(900) });
    expect(calls[0].values[2]).toHaveLength(500);
  });
  it('never throws when the database write fails (the job it describes must go on)', async () => {
    const { sql } = recorder(true);
    await expect(recordHeartbeat(sql, 'alerts', { townId: 'glasgow', ok: true })).resolves.toBeUndefined();
    await expect(recordHeartbeats(sql, 'alerts', [{ townId: 'a', ok: true }, { townId: 'b', ok: false, error: 'e' }])).resolves.toBeUndefined();
  });
  it('writes every town even when one write fails', async () => {
    let n = 0;
    const sql = (async () => {
      n++;
      if (n === 1) throw new Error('boom');
      return [];
    }) as any;
    await recordHeartbeats(sql, 'alerts', [{ townId: 'a', ok: true }, { townId: 'b', ok: true }, { townId: 'c', ok: true }]);
    expect(n).toBe(3);
  });
});

describe('safetyTownResults', () => {
  it('is healthy when fire is fine and air is skipped for a missing key', () => {
    expect(safetyTownResults([
      { townId: 'moreno_valley_ca', part: 'fire', ok: true },
      { townId: 'moreno_valley_ca', part: 'air', ok: true, skipped: 'AIRNOW_API_KEY not set' },
    ])).toEqual([{ townId: 'moreno_valley_ca', ok: true }]);
  });
  it('a failed part makes the town failed and names the part', () => {
    const [r] = safetyTownResults([
      { townId: 'broomfield_co', part: 'fire', ok: true },
      { townId: 'broomfield_co', part: 'air', ok: false, error: 'AirNow 500' },
    ]);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('air: AirNow 500');
  });
  it('keeps towns apart', () => {
    const r = safetyTownResults([
      { townId: 'a', part: 'fire', ok: false, error: 'x' },
      { townId: 'b', part: 'fire', ok: true },
    ]);
    expect(r.map((x) => [x.townId, x.ok])).toEqual([['a', false], ['b', true]]);
  });
});

it('the job names are the ones the freshness check reads', () => {
  expect([...HEARTBEAT_JOBS]).toEqual(['alerts', 'safety']);
});
