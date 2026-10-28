import { describe, it, expect } from 'vitest';
import { isEventPermalink, withPrunedEventRedirect } from './pruned-events';

const req = (path: string, method = 'GET') => new Request(`https://morenovalleyview.com${path}`, { method });

describe('isEventPermalink', () => {
  it('matches event permalinks only', () => {
    expect(isEventPermalink('/s/event-5639/')).toBe(true);
    expect(isEventPermalink('/s/event-5639')).toBe(true);
    expect(isEventPermalink('/s/event-5639.ics')).toBe(false);
    expect(isEventPermalink('/s/meeting-2026-08-27-11040/')).toBe(false);
    expect(isEventPermalink('/s/event-series-x/')).toBe(false);
  });
});

describe('withPrunedEventRedirect', () => {
  it('301s a missing event page to /events/past/', async () => {
    const res = await withPrunedEventRedirect(req('/s/event-1/'), async () => new Response('nf', { status: 404 }));
    expect(res!.status).toBe(301);
    expect(res!.headers.get('location')).toBe('https://morenovalleyview.com/events/past/');
  });
  it('serves an event page that exists', async () => {
    const res = await withPrunedEventRedirect(req('/s/event-1/'), async () => new Response('ok', { status: 200 }));
    expect(res!.status).toBe(200);
  });
  it('leaves other paths and methods alone', async () => {
    expect(await withPrunedEventRedirect(req('/s/other/'), async () => new Response('', { status: 404 }))).toBeNull();
    expect(await withPrunedEventRedirect(req('/s/event-1/', 'POST'), async () => new Response('', { status: 404 }))).toBeNull();
  });
});
