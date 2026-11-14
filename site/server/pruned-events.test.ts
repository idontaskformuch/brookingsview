import { describe, it, expect } from 'vitest';
import { isEventPermalink, isSeriesPermalink, mergedOccurrenceRedirect, withPrunedEventRedirect } from './pruned-events';

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

// Frozen sources (owner 2026-11-13): a hidden series and a merged occurrence whose series is hidden go to /events/ with a 302.
// event-series-646343abc31524a1 ("Moreno Valley: IRIS PLAZA: Family Fun", library, next date 2 Dec) is hidden after the window;
// event-6230 is a merged occurrence of event-series-c58028a9cbe64a93 (event-series-redirects.json).
describe('hidden series (frozen source)', () => {
  it('matches series permalinks only', () => {
    expect(isSeriesPermalink('/s/event-series-646343abc31524a1/')).toBe(true);
    expect(isSeriesPermalink('/s/event-6230/')).toBe(false);
  });
  it('302s a missing series page to /events/, serves one that exists', async () => {
    const gone = await withPrunedEventRedirect(req('/s/event-series-646343abc31524a1/'), async () => new Response('nf', { status: 404 }));
    expect(gone!.status).toBe(302);
    expect(gone!.headers.get('location')).toBe('https://morenovalleyview.com/events/');
    const ok = await withPrunedEventRedirect(req('/s/event-series-646343abc31524a1/'), async () => new Response('ok', { status: 200 }));
    expect(ok!.status).toBe(200);
  });
  it('a merged occurrence keeps its 301 to a built series, and 302s to /events/ when the series is hidden', async () => {
    const seen: string[] = [];
    const built = await mergedOccurrenceRedirect(req('/s/event-6230/?a=1'), '/s/event-series-c58028a9cbe64a93/',
      async (r) => { seen.push(new URL(r.url).pathname); return new Response('ok', { status: 200 }); });
    expect(built.status).toBe(301);
    expect(built.headers.get('location')).toBe('https://morenovalleyview.com/s/event-series-c58028a9cbe64a93/?a=1');
    expect(seen).toEqual(['/s/event-series-c58028a9cbe64a93/']);
    const hidden = await mergedOccurrenceRedirect(req('/s/event-6230/'), '/s/event-series-c58028a9cbe64a93/',
      async () => new Response('nf', { status: 404 }));
    expect(hidden.status).toBe(302);
    expect(hidden.headers.get('location')).toBe('https://morenovalleyview.com/events/');
  });
  // event-197946 ("Moreno Valley: Library Closed - Christmas / Biblioteca cerrada - Navidad", library, 24 Dec) is hidden after the window.
  it('302s a missing dated event listed in frozen-hidden-events.json to /events/, 301s any other to the archive', async () => {
    const assets = (list: Response) => async (r: Request) =>
      new URL(r.url).pathname === '/frozen-hidden-events.json' ? list : new Response('nf', { status: 404 });
    const hidden = await withPrunedEventRedirect(req('/s/event-197946/'), assets(Response.json(['event-197946', 'event-204322'])));
    expect(hidden!.status).toBe(302);
    expect(hidden!.headers.get('location')).toBe('https://morenovalleyview.com/events/');
    const old = await withPrunedEventRedirect(req('/s/event-5639/'), assets(Response.json(['event-197946'])));
    expect(old!.status).toBe(301);
    expect(old!.headers.get('location')).toBe('https://morenovalleyview.com/events/past/');
    const noList = await withPrunedEventRedirect(req('/s/event-197946/'), assets(new Response('nf', { status: 404 })));
    expect(noList!.status).toBe(301);
  });
  it('a merged duplicate that points to a dated event (not a series) is the plain 301, no lookup', async () => {
    let looked = false;
    const res = await mergedOccurrenceRedirect(req('/s/event-1/'), '/s/event-2/', async () => { looked = true; return new Response('', { status: 404 }); });
    expect(res.status).toBe(301);
    expect(looked).toBe(false);
  });
});
