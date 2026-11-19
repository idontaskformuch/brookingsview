import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import CityAnswers from '../components/answers/CityAnswers.astro';
import AboutThisPage from '../components/ui/AboutThisPage.astro';
import { BROOKINGS_ANSWERS } from '../config/city-answers/brookings_sd';
import { inlineHtml } from './city-answers';
import { visibleText } from './visible-text.mjs';

// K1 (owner 2026-11-19): Brookings' trash guide moved from pages/trash-recycling.astro into config/city-answers/brookings_sd.ts and the shared
// CityAnswers layout with byte-identical content. The fixture is the visible text and link targets of /trash-recycling/ as built on 19 Nov
// 2026 from commit 26ea983 (the old page), from its <header class="lede"> to the end of About this page.
const FIXTURE = JSON.parse(readFileSync(new URL('./fixtures/trash-recycling-brookings-2026-11-19.json', import.meta.url), 'utf8')) as { title: string; description: string; text: string; hrefs: string[] };
const PAGE = BROOKINGS_ANSWERS.find((p) => p.slug === 'trash-recycling')!;

afterEach(() => { vi.useRealTimers(); });

describe('K1: Brookings trash guide, same content before and after the move', () => {
  it('visible text and every link target are identical to the page built on 19 Nov 2026', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-19T11:00:00Z')); // the fixture's build time (the holiday table depends on today)
    const c = await AstroContainer.create();
    const body = await c.renderToString(CityAnswers, { props: { page: PAGE, today: '2026-11-19' } });
    const about = await c.renderToString(AboutThisPage, { slots: { default: `<p>${inlineHtml(PAGE.about)}</p>` } });
    const now = visibleText(body + about);
    expect(now.text).toBe(FIXTURE.text);
    expect(now.hrefs).toEqual(FIXTURE.hrefs);
  });
  it('title and description are the same', () => {
    expect(PAGE.title.replace('{Site}', 'Brookings View').replace('&', '&amp;')).toBe(FIXTURE.title);
    expect(PAGE.description).toBe(FIXTURE.description);
  });
});
