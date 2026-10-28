import { describe, expect, it } from 'vitest';
import { MAX_NEW_INDEXABLE, checkNewIndexable, childSitemaps, fetchLiveSitemapPaths, newIndexable, sitemapPaths } from '../../scripts/new-indexable.mjs';

const xml = (paths: string[]) => `<urlset>${paths.map((p) => `<url><loc>https://x.test${p}</loc></url>`).join('')}</urlset>`;
const many = (n: number) => Array.from({ length: n }, (_, i) => `/p${i}/`);

describe('new-indexable guard', () => {
  it('reads pathnames out of a sitemap and children out of an index', () => {
    expect(sitemapPaths(xml(['/a/', '/b/']))).toEqual(['/a/', '/b/']);
    expect(childSitemaps('<sitemapindex><sitemap><loc>https://x.test/sitemap-0.xml</loc></sitemap></sitemapindex>')).toEqual(['https://x.test/sitemap-0.xml']);
  });
  it('counts only pages the live site does not advertise yet', () => {
    expect(newIndexable(['/a/', '/b/', '/c/'], ['/a/', '/old/'])).toEqual(['/b/', '/c/']);
  });
  it('passes up to the limit, fails one over, and says what was added', () => {
    expect(MAX_NEW_INDEXABLE).toBe(30);
    expect(checkNewIndexable(many(30), [], undefined).ok).toBe(true);
    const over = checkNewIndexable(many(31), [], undefined);
    expect(over.ok).toBe(false);
    expect(over.count).toBe(31);
    expect(over.message).toContain('31 new indexable pages');
    expect(over.message).toContain('ALLOW_NEW_INDEXABLE_PAGES=yes');
  });
  it('an explicit yes lets a big addition through, visibly; nothing else does', () => {
    const r = checkNewIndexable(many(45), [], 'yes');
    expect(r.ok).toBe(true);
    expect(r.message).toContain('allowed by ALLOW_NEW_INDEXABLE_PAGES=yes');
    expect(checkNewIndexable(many(45), [], 'true').ok).toBe(false);
  });
  it('an established site growing by a few pages never trips it', () => {
    expect(checkNewIndexable([...many(200), '/new/'], many(200), undefined).count).toBe(1);
  });
  it('an unreadable live sitemap is null (the guard only warns), a readable one is flattened', async () => {
    expect(await fetchLiveSitemapPaths('https://x.test', (async () => new Response('', { status: 404 })) as typeof fetch)).toBeNull();
    expect(await fetchLiveSitemapPaths('https://x.test', (async () => { throw new Error('offline'); }) as typeof fetch)).toBeNull();
    const fetcher = (async (u: any) => new Response(String(u).endsWith('sitemap-index.xml')
      ? '<sitemapindex><sitemap><loc>https://x.test/sitemap-0.xml</loc></sitemap></sitemapindex>' : xml(['/a/', '/b/']))) as typeof fetch;
    expect(await fetchLiveSitemapPaths('https://x.test', fetcher)).toEqual(['/a/', '/b/']);
  });
});
