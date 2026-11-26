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
  it('the description is the one of the page as it was served 2026-11-19; the title is the owner\'s new one (order 2026-11-26 (12))', () => {
    // The fixture's title is the old live one, "Trash & Recycling Guide | Brookings View": the owner changed it (town first, no suffix).
    expect(FIXTURE.title).toBe('Trash &amp; Recycling Guide | Brookings View');
    expect(PAGE.title).toBe('Brookings Trash & Recycling: Pickup Days & Rules');
    expect(PAGE.description).toBe(FIXTURE.description);
  });
});

describe('K2: after 24 November the yard waste season reads as over, never as coming', () => {
  // Source /264/Yard-Waste, read 2026-11-19: "Seasonal yard waste collection runs April 6, 2026 to November 24, 2026."
  const render = async (iso: string, today: string) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(iso));
    return visibleText(await (await AstroContainer.create()).renderToString(CityAnswers, { props: { page: PAGE, today } })).text;
  };
  it('on 24 Nov (the last day) the season still runs', async () => {
    const t = await render('2026-11-24T18:00:00Z', '2026-11-24');
    expect(t).toContain('Yard waste collection runs April 6 to November 24, 2026 and does not run in winter.');
    expect(t).not.toContain('season ended');
  });
  it('from 25 Nov no line speaks of 24 November as coming, and the page says the season is over', async () => {
    const t = await render('2026-11-25T18:00:00Z', '2026-11-25');
    expect(t).toContain('The 2026 yard waste season ended November 24.');
    expect(t).toContain('The 2026 collection ran April 6 to November 24 and is over for the year.');
    expect(t).toContain('Yard waste collection ended for the year on November 24, 2026');
    expect(t).not.toMatch(/runs April 6 to November 24|ends November 24/);
  });
});
