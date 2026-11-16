import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MIN_INDEXABLE_PROJECTS_HUB, shouldNoindexProjectsHub } from './project-noindex';
import { HOME_SALES_STALE_DAYS, homeSalesStale } from './home-sales';
import { ELECTION_BY_TOWN } from '../config/election';

// SPEC Fas 13b (audit pass 6, owner 2026-11-16): thin indexable pages go noindex, and the sitemap filter in astro.config.mjs
// agrees with each page's own tag (the build's disjoint check catches a mismatch against real data; these catch the mirrors).
const cfg = readFileSync(new URL('../../astro.config.mjs', import.meta.url), 'utf8');
const page = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

describe('/city-hall/projects/ hub', () => {
  it('is noindex under 3 projects (Glasgow 0, Broomfield 1, Brookings 2 on 2026-11-16), indexable from 3 (Moreno 6)', () => {
    expect(shouldNoindexProjectsHub(0)).toBe(true);
    expect(shouldNoindexProjectsHub(2)).toBe(true);
    expect(shouldNoindexProjectsHub(3)).toBe(false);
    expect(shouldNoindexProjectsHub(6)).toBe(false);
  });
  it('astro.config.mjs mirrors the same minimum and the page passes it to the layout', () => {
    expect(cfg).toContain(`const MIN_INDEXABLE_PROJECTS_HUB = ${MIN_INDEXABLE_PROJECTS_HUB};`);
    expect(page('pages/city-hall/projects/index.astro')).toContain('noindex={noindex}');
  });
});

describe('/home-sales/ and /home-sales/archive/ while the county data is stale (B6)', () => {
  const day = 86_400_000;
  // Moreno's newest recorded sale on 2026-11-16 was 2025-10-31 (audit 06-prune.md 2b).
  const now = Date.parse('2026-11-16T12:00:00Z');
  it('stale past 120 days, not before; no sale at all is not stale', () => {
    expect(homeSalesStale('2025-10-31', now)).toBe(true);
    expect(homeSalesStale(new Date(now - 119 * day), now)).toBe(false);
    expect(homeSalesStale(new Date(now - 121 * day), now)).toBe(true);
    expect(homeSalesStale(null, now)).toBe(false);
  });
  it('astro.config.mjs mirrors the same number for both pages, and both pages pass the verdict to the layout', () => {
    expect(cfg).toContain(`const HOME_SALES_STALE_DAYS = ${HOME_SALES_STALE_DAYS};`);
    expect(cfg).toContain("noindexThinPageUrls.add('/home-sales/archive/');");
    expect(page('pages/home-sales.astro')).toContain('noindex={recordsAreStale}');
    expect(page('pages/home-sales/archive.astro')).toContain('noindex={recordsAreStale}');
  });
});

describe('/election-results/ that only links to the official source', () => {
  it('astro.config.mjs lists exactly the towns whose results block is link-only', () => {
    const m = cfg.match(/const ELECTION_RESULTS_LINK_ONLY = (\[[^\]]*\]);/);
    expect(m).not.toBeNull();
    const mirror = (Function(`return ${m![1]}`)() as string[]).sort();
    const linkOnly = Object.entries(ELECTION_BY_TOWN).filter(([, e]) => e.enabled && e.results && !e.results.live).map(([t]) => t).sort();
    expect(mirror).toEqual(linkOnly);
    expect(linkOnly).toEqual(['moreno_valley_ca']);
  });
  it('the page is noindex when results are not live', () => {
    expect(page('pages/election-results.astro')).toContain('const noindex = !results.live ||');
  });
});

describe('games and paginated archive pages', () => {
  it('/play/ and /burro-bonanza/ are noindex in the page and out of the sitemap', () => {
    expect(page('pages/play.astro')).toMatch(/<BaseLayout\s+noindex\b/);
    expect(page('pages/burro-bonanza.astro')).toMatch(/<BaseLayout\s+noindex\b/);
    expect(cfg).toContain("'/play/', '/burro-bonanza/'");
  });
  it('archive pages over page 1 are noindex and kept out of the sitemap by path', () => {
    expect(page('components/meetings/ArchivePage.astro')).toContain('noindex={page > 1}');
    expect(cfg).toContain("pathname.startsWith('/city-hall/archive/page/')");
  });
});
