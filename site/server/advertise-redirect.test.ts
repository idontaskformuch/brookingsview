import { describe, expect, it } from 'vitest';
import worker from './worker';

const env = { ASSETS: { fetch: async () => new Response('asset', { status: 200 }) } } as never;
const ctx = { waitUntil() {} } as never;

describe('/advertise -> /advertising/', () => {
  it('answers a permanent redirect, with or without a trailing slash, keeping the query', async () => {
    for (const path of ['/advertise', '/advertise/']) {
      const res = await worker.fetch(new Request(`https://brookingsview.com${path}?utm=x`), env, ctx);
      expect(res.status, path).toBe(301);
      expect(res.headers.get('location')).toBe('https://brookingsview.com/advertising/?utm=x');
    }
  });
  it('leaves /advertising/ alone', async () => {
    const res = await worker.fetch(new Request('https://brookingsview.com/advertising/'), env, ctx);
    expect(res.status).toBe(200);
  });
});
