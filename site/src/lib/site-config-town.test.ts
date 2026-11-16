import { afterEach, describe, it, expect, vi } from 'vitest';

// Audit Fas 2 (P4-3): a missing or unknown SITE_CITY used to give Brookings silently.
describe('site-config: no fallback town', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

  it.each(['finns_inte', ''])('SITE_CITY=%j throws with the id in the message', async (id) => {
    vi.stubEnv('SITE_CITY', id);
    vi.resetModules();
    await expect(import('./site-config')).rejects.toThrow(`unknown SITE_CITY ${JSON.stringify(id)}`);
  });

  it('a real town loads that town, not Brookings', async () => {
    vi.stubEnv('SITE_CITY', 'glasgow');
    vi.resetModules();
    const { siteConfig } = await import('./site-config');
    expect(siteConfig.townId).toBe('glasgow');
  });
});
