import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleTicketmasterImage } from './ticketmaster-image';

// This repo's vitest config runs in a plain Node environment (see
// vitest.config.ts's own comment) -- no real Cloudflare `caches` global,
// no real ExecutionContext. Both are faked here, injected explicitly
// (handleTicketmasterImage's own `cacheStorage` parameter), the same
// dependency-injection shape this codebase already uses for `env`/`sql` in
// comment.ts and shift-poll-vote.ts.
function fakeCacheStorage() {
  const store = new Map<string, Response>();
  return {
    default: {
      async match(request: Request) { return store.get(request.url)?.clone() ?? undefined; },
      async put(request: Request, response: Response) { store.set(request.url, response); },
    },
  } as unknown as CacheStorage;
}

function fakeCtx(): ExecutionContext {
  return { waitUntil: (p: Promise<unknown>) => { void p; }, passThroughOnException: () => {} } as unknown as ExecutionContext;
}

function fakeEnv() {
  return {
    DATABASE_URL: '', ANTHROPIC_API_KEY: '', IP_HASH_SALT: '', TURNSTILE_SECRET_KEY: '',
    CONTACT_TO_ADDRESS: '', DEV_TOWN_ID: 'brookings_sd',
    ASSETS: {
      async fetch(request: Request) {
        return new Response('placeholder-bytes', {
          status: 200,
          headers: { 'Content-Type': 'image/png', 'X-Asset-Path': new URL(request.url).pathname },
        });
      },
    },
  };
}

const REAL_URL = 'https://s1.ticketm.net/dam/a/real-event-photo.jpg';

afterEach(() => { vi.unstubAllGlobals(); });

describe('handleTicketmasterImage', () => {
  it('rejects a request with no u parameter', async () => {
    const res = await handleTicketmasterImage(
      new Request('https://brookingsview.com/img/ticketmaster'), fakeEnv(), fakeCtx(), fakeCacheStorage(),
    );
    expect(res.status).toBe(400);
  });

  it('rejects a host outside the Ticketmaster image CDN allowlist (SSRF guard)', async () => {
    const evil = encodeURIComponent('https://attacker.example/internal-metadata');
    const res = await handleTicketmasterImage(
      new Request(`https://brookingsview.com/img/ticketmaster?u=${evil}`), fakeEnv(), fakeCtx(), fakeCacheStorage(),
    );
    expect(res.status).toBe(400);
  });

  it('fetches, caches, and serves the real image on a cold cache', async () => {
    const fetchMock = vi.fn(async () => new Response('real-image-bytes', {
      status: 200, headers: { 'Content-Type': 'image/jpeg' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const cacheStorage = fakeCacheStorage();
    const ctx = fakeCtx();
    const req = new Request(`https://brookingsview.com/img/ticketmaster?u=${encodeURIComponent(REAL_URL)}`);
    const res = await handleTicketmasterImage(req, fakeEnv(), ctx, cacheStorage);

    expect(res.status).toBe(200);
    expect(await res.text()).toBe('real-image-bytes');
    expect(res.headers.get('Cache-Control')).toMatch(/max-age=604800/);
    expect(fetchMock).toHaveBeenCalledWith(REAL_URL);
  });

  it('serves the cached response on a second request without re-fetching upstream', async () => {
    const fetchMock = vi.fn(async () => new Response('real-image-bytes', {
      status: 200, headers: { 'Content-Type': 'image/jpeg' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const cacheStorage = fakeCacheStorage();
    const url = `https://brookingsview.com/img/ticketmaster?u=${encodeURIComponent(REAL_URL)}`;
    await handleTicketmasterImage(new Request(url), fakeEnv(), fakeCtx(), cacheStorage);
    const second = await handleTicketmasterImage(new Request(url), fakeEnv(), fakeCtx(), cacheStorage);

    expect(await second.text()).toBe('real-image-bytes');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to the town placeholder when the upstream fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    const req = new Request(`https://brookingsview.com/img/ticketmaster?u=${encodeURIComponent(REAL_URL)}`);
    const res = await handleTicketmasterImage(req, fakeEnv(), fakeCtx(), fakeCacheStorage());

    expect(res.status).toBe(200);
    expect(await res.text()).toBe('placeholder-bytes');
  });

  it('falls back to the town placeholder when Ticketmaster returns a non-ok status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Not Found', { status: 404 })));
    const req = new Request(`https://brookingsview.com/img/ticketmaster?u=${encodeURIComponent(REAL_URL)}`);
    const res = await handleTicketmasterImage(req, fakeEnv(), fakeCtx(), fakeCacheStorage());

    expect(res.status).toBe(200);
    expect(await res.text()).toBe('placeholder-bytes');
  });

  it('picks the placeholder for the requesting town, not always Brookings', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { status: 500 })));
    const assetsFetch = vi.fn(async (request: Request) =>
      new Response('placeholder-bytes', { status: 200, headers: { 'Content-Type': 'image/png' } }));
    const env = { ...fakeEnv(), DEV_TOWN_ID: 'moreno_valley_ca', ASSETS: { fetch: assetsFetch } };
    const req = new Request(`https://morenovalleyview.com/img/ticketmaster?u=${encodeURIComponent(REAL_URL)}`);
    await handleTicketmasterImage(req, env, fakeCtx(), fakeCacheStorage());

    expect(assetsFetch).toHaveBeenCalledTimes(1);
    const requestedPath = new URL(assetsFetch.mock.calls[0][0].url).pathname;
    expect(requestedPath).toBe('/assets/images/categories/moreno_valley_ca-events-1.png');
  });
});
