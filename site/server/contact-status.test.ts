import { describe, expect, it } from 'vitest';
import { handleContactStatus } from './contact-status';

const body = async (env: Parameters<typeof handleContactStatus>[0]) => (await handleContactStatus(env).json()) as { available: boolean };

describe('GET /api/contact-status', () => {
  it('is false until both the Resend and the Turnstile secrets exist', async () => {
    expect(await body({ RESEND_API_KEY: undefined, TURNSTILE_SECRET_KEY: '' as string })).toEqual({ available: false });
    expect(await body({ RESEND_API_KEY: 're_x', TURNSTILE_SECRET_KEY: '' as string })).toEqual({ available: false });
    expect(await body({ RESEND_API_KEY: undefined, TURNSTILE_SECRET_KEY: 'ts' })).toEqual({ available: false });
  });
  it('is true when both exist, and never echoes a secret', async () => {
    const r = handleContactStatus({ RESEND_API_KEY: 're_secret', TURNSTILE_SECRET_KEY: 'ts_secret' });
    const text = await r.text();
    expect(JSON.parse(text)).toEqual({ available: true });
    expect(text).not.toContain('secret');
  });
});
