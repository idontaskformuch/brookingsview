import { describe, expect, it } from 'vitest';
import { frontPageAlerts } from './front-page-alerts';

const row = (alert: { source: string | null; title: string | null; level: string | null }, ends_at: string | null = '2026-11-20T00:00:00Z') => ({ ends_at, alert });

describe('frontPageAlerts', () => {
  it('maps an NWS row to its event name, from the source title', () => {
    const [a] = frontPageAlerts([row({ source: 'nws_alert', title: 'Tornado Warning', level: null })]);
    expect(a).toMatchObject({ kind: 'weather', event: 'Tornado Warning', headline: 'Tornado Warning', until: '2026-11-20T00:00:00Z' });
  });
  it('maps a Met Office row to its level', () => {
    const [a] = frontPageAlerts([row({ source: 'met_office_warning', title: 'Wind warning', level: 'amber' })]);
    expect(a).toMatchObject({ kind: 'weather', level: 'amber' });
    expect(a.event).toBeUndefined();
  });
  it('drops county re-posts, rows without a title and Met Office rows without a level', () => {
    expect(frontPageAlerts([
      row({ source: 'county_alert', title: 'Freeze Warning', level: null }),
      row({ source: 'nws_alert', title: ' ', level: null }),
      row({ source: 'met_office_warning', title: 'Rain', level: '' }),
      { ends_at: null },
    ])).toEqual([]);
  });
});
