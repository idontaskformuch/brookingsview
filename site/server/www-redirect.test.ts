import { describe, expect, it } from 'vitest';
import worker from './worker';

const env = { ASSETS: { fetch: async () => new Response('asset', { status: 200 }) } } as never;
const ctx = { waitUntil() {} } as never;

describe('www. -> apex (301, path and query kept)', () => {
  it.each(['brookingsview.com', 'morenovalleyview.com', 'broomfieldview.com', 'glasgowloop.co.uk'])('%s', async (apex) => {
    const res = await worker.fetch(new Request(`https://www.${apex}/events/?a=1`), env, ctx);
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe(`https://${apex}/events/?a=1`);
  });
  it('leaves the apex alone', async () => {
    expect((await worker.fetch(new Request('https://brookingsview.com/'), env, ctx)).status).toBe(200);
  });
});
