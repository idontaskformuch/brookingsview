import { describe, expect, it } from 'vitest';
import { activeAlerts, alertEndsAt, formatAlertUntil, isAlertActive, parseAlertEnd, type AlertRow } from './alerts';

const CHI = 'America/Chicago';
const iso = (d: Date | null) => (d ? d.toISOString().replace('.000Z', 'Z') : null);

// Real county_alert rows from the production DB (Brookings, ends_at NULL).
const FOG: AlertRow = {
  ends_at: null, starts_at: '2026-10-12T05:56:00Z',
  title: 'Dense Fog Advisory from 10/12/2026 4:10 AM to 1:00 PM CDT for Brookings County, SD',
};
const FREEZE: AlertRow = {
  ends_at: null, starts_at: '2026-10-16T11:10:00Z',
  title: '...FREEZE WARNING IN EFFECT FROM MIDNIGHT  TONIGHT TO 9 AM CDT SATURDAY...',
};

describe('parseAlertEnd on real county_alert titles', () => {
  it.each([
    ['Heat Advisory from 7/17/2026 1:00 PM to 9:00 PM CDT for Brookings County, SD', '2026-07-17T09:00:00Z', '2026-07-18T02:00:00Z'],
    ['Heat Advisory for Brookings County from 12:00 PM Saturday July 25, 2026 - 8:00 PM Sunday July26, 2026.', '2026-07-24T16:40:00Z', '2026-07-27T01:00:00Z'],
    ['SEVERE THUNDERSTORM WATCH 513 IN EFFECT UNTIL 11 PM CDT THIS EVENING FOR  BROOKINGS COUNTY, SD', '2026-07-25T16:23:00Z', '2026-07-26T04:00:00Z'],
    ['SEVERE THUNDERSTORM WATCH 664 IN EFFECT UNTIL 2 AM CDT TUESDAY FOR BROOKINGS COUNTY, SD', '2026-09-07T19:23:00Z', '2026-09-08T07:00:00Z'],
    ['WIND ADVISORY IN EFFECT FROM 7 AM THIS MORNING TO 1 PM CDT THIS AFTERNOON FOR BROOKINGS COUNTY, SD', '2026-10-03T03:25:00Z', '2026-10-03T18:00:00Z'],
    [FOG.title, FOG.starts_at!, '2026-10-12T18:00:00Z'],
    [FREEZE.title, FREEZE.starts_at!, '2026-10-17T14:00:00Z'],
  ])('%s', (title, start, expected) => {
    expect(iso(parseAlertEnd(title, new Date(start), CHI))).toBe(expected);
  });

  it('returns null when the text has no end clause', () => {
    expect(parseAlertEnd('Flash Flood Warning for Brookings County, SD', new Date('2026-09-06T14:14:00Z'), CHI)).toBeNull();
  });
});

describe('alertEndsAt / isAlertActive', () => {
  it('prefers the stored ends_at', () => {
    const row: AlertRow = { ends_at: '2026-10-17T14:00:00Z', starts_at: '2026-10-17T05:00:00Z', title: 'Freeze Warning' };
    expect(iso(alertEndsAt(row, CHI))).toBe('2026-10-17T14:00:00Z');
  });

  it('falls back to 24 h after start when nothing parses', () => {
    const row: AlertRow = { ends_at: null, starts_at: '2026-09-06T14:14:00Z', title: 'Flash Flood Warning for Brookings County, SD' };
    expect(iso(alertEndsAt(row, CHI))).toBe('2026-09-07T14:14:00Z');
    expect(isAlertActive(row, new Date('2026-09-07T14:13:00Z'), CHI)).toBe(true);
    expect(isAlertActive(row, new Date('2026-09-07T14:15:00Z'), CHI)).toBe(false);
  });

  it('is not shown without any usable start or end', () => {
    expect(isAlertActive({ ends_at: null, starts_at: null, title: 'x' }, new Date(), CHI)).toBe(false);
  });
});

describe('fixture: the 10/12 fog and 10/16 freeze alerts on 2026-10-20', () => {
  const now = new Date('2026-10-20T19:38:00Z');
  it('shows zero active alerts', () => {
    expect(activeAlerts([FOG, FREEZE], now, CHI)).toHaveLength(0);
  });
  it('freeze is active until its end, gone right after', () => {
    expect(isAlertActive(FREEZE, new Date('2026-10-17T13:59:59Z'), CHI)).toBe(true);
    expect(isAlertActive(FREEZE, new Date('2026-10-17T14:00:00Z'), CHI)).toBe(false);
  });
});

describe('DST fall-back, Sun 2026-11-01 (01:00-02:00 local happens twice)', () => {
  // NWS text uses a fixed-offset abbreviation, so CDT 1 AM (06:00Z) is unambiguous.
  const row: AlertRow = {
    ends_at: null, starts_at: '2026-11-01T04:00:00Z',
    title: 'Wind Advisory IN EFFECT UNTIL 1 AM CDT SUNDAY',
  };
  it('parses 1 AM CDT as 06:00Z, not the second 1 AM (CST, 07:00Z)', () => {
    // Start is Sat 11:00 PM CDT; "SUNDAY" is the next day.
    expect(iso(alertEndsAt(row, CHI))).toBe('2026-11-01T06:00:00Z');
  });
  it('stored ends_at across the repeated hour is compared as an instant', () => {
    const r: AlertRow = { ends_at: '2026-11-01T07:30:00Z', starts_at: '2026-11-01T05:00:00Z', title: 't' };
    expect(isAlertActive(r, new Date('2026-11-01T07:29:00Z'), CHI)).toBe(true);
    expect(isAlertActive(r, new Date('2026-11-01T07:31:00Z'), CHI)).toBe(false);
  });
});

describe('county_alert filtering (owner decision 2026-10-20)', () => {
  const now = new Date('2026-10-17T06:00:00Z'); // freeze text is parseable and still "in force"
  it('drops weather re-posts even while their parsed end is in the future', () => {
    const row: AlertRow = { ...FREEZE, source: 'county_alert', category: 'Hazardous Weather Alerts' };
    expect(isAlertActive(row, now, CHI)).toBe(false);
    expect(activeAlerts([row], now, CHI)).toHaveLength(0);
  });
  it('keeps a fresh non-weather county notice', () => {
    const row: AlertRow = { ends_at: null, starts_at: '2026-10-17T00:00:00Z', title: 'Bridge closed on County Road 33', source: 'county_alert', category: 'Road Closures' };
    expect(isAlertActive(row, now, CHI)).toBe(true);
  });
  it('never shows the 2022-23 road-work notices, even with a parseable end', () => {
    const old: AlertRow = { ends_at: null, starts_at: '2022-09-07T08:11:00Z', title: 'Crossbucks installed until 5 PM CDT Friday', source: 'county_alert', category: 'Road Closures' };
    expect(isAlertActive(old, new Date('2022-09-07T09:00:00Z'), CHI)).toBe(true);   // fresh then
    expect(isAlertActive(old, now, CHI)).toBe(false);                               // stale now
  });
  it('does not touch nws_alert rows', () => {
    const nws: AlertRow = { ends_at: '2026-10-17T14:00:00Z', starts_at: '2026-10-17T05:00:00Z', title: 'Freeze Warning', source: 'nws_alert', category: 'Hazardous Weather Alerts' };
    expect(isAlertActive(nws, now, CHI)).toBe(true);
  });
});

describe('formatAlertUntil', () => {
  it('uses the town zone with weekday and date', () => {
    expect(formatAlertUntil(new Date('2026-10-24T14:00:00Z'), CHI)).toBe('until 9 AM Sat Oct 24');
    expect(formatAlertUntil(new Date('2026-10-24T14:30:00Z'), CHI)).toBe('until 9:30 AM Sat Oct 24');
    expect(formatAlertUntil(new Date('2026-10-24T14:00:00Z'), 'America/Los_Angeles')).toBe('until 7 AM Sat Oct 24');
    expect(formatAlertUntil(new Date('2026-10-25T05:30:00Z'), 'America/Denver')).toBe('until 11:30 PM Sat Oct 24');
  });
});
