import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import CityAnswers from '../components/answers/CityAnswers.astro';
import { BROOMFIELD_ANSWERS } from '../config/city-answers/broomfield_co';
import { answerPagesFor } from '../config/city-answers';
import { answerMeta } from './city-answers';
import { visibleText } from './visible-text.mjs';

// Broomfield B1-B5 (owner 2026-11-19). Facts are checked against the pages read on 2026-11-19 (.claude/evidence/city-answers-2026-11/).
const page = (slug: string) => BROOMFIELD_ANSWERS.find((p) => p.slug === slug)!;
const render = async (slug: string, today: string) => visibleText(await (await AstroContainer.create()).renderToString(CityAnswers, { props: { page: page(slug), today } })).text;
const evidence = (f: string) => {
  try { return readFileSync(new URL(`../../../.claude/evidence/city-answers-2026-11/${f}`, import.meta.url), 'utf8').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' '); }
  catch { return null; } // the notes repo is not in every checkout (CI)
};

describe('Broomfield answer pages', () => {
  it('B1 (Christmas trees) is a draft: built only with PREVIEW_DRAFTS=1, and unconfirmed', () => {
    expect(answerPagesFor('broomfield_co').map((p) => p.slug)).toEqual(['trash-recycling', 'leaf-branch-drop-off', 'snow-plowing', 'pay-water-bill']);
    expect(answerPagesFor('broomfield_co', true).map((p) => p.slug)).toContain('christmas-tree-recycling');
    expect(page('christmas-tree-recycling').answers.every((a) => a.unconfirmed)).toBe(true);
  });
  it('B2 names no pickup day and no holiday shift (the source has neither)', async () => {
    const t = await render('trash-recycling', '2026-11-19');
    expect(t).toContain('Waste Connections of Colorado');
    expect(t).not.toMatch(/\b(Monday|Tuesday|Wednesday|Thursday|Friday)\b|holiday/i);
  });
  it('B3: a closed day disappears once it has passed; with none left the page says so', async () => {
    const nov19 = await render('leaf-branch-drop-off', '2026-11-19');
    expect(nov19).toContain('Saturday, November 28, 2026');
    const nov29 = await render('leaf-branch-drop-off', '2026-11-29');
    expect(nov29).not.toContain('November 28');
    expect(nov29).toContain('Wednesday, December 23, 2026');
    const jan3 = await render('leaf-branch-drop-off', '2027-01-03');
    expect(jan3).toContain('No closed days are listed for the coming weeks.');
    expect(jan3).not.toMatch(/December 2[36]|January 2, 2027/);
  });
  it('B3: the page\'s <title>, meta, fact rows and closed days all come from its `facility` (owner order 2026-11-26 (11))', async () => {
    const m = answerMeta(page('leaf-branch-drop-off'), { siteName: 'Broomfield View', town: 'Broomfield', today: '2026-11-26' });
    expect(m.title).toBe('Broomfield Leaf & Branch Drop-Off: Hours & Rules (2026)');
    expect(m.description).toBe('Free for Broomfield residents at 2990 W 124th Ave. Open Wed 1–5 PM & Sat 8 AM–5 PM. Next closed: Sat Nov 28. Accepted items, size limits, residency rules.');
    const t = await render('leaf-branch-drop-off', '2026-11-26');
    // The rows as the page had them before the fields: hours, address and the closed days appear once, as written.
    for (const s of ['Tree Branch Recycling Facility, 2990 W 124th Avenue', 'Wednesdays 1 to 5 p.m. and Saturdays 8 a.m. to 5 p.m., year-round, with some exceptions for holidays.',
      'Broomfield residents only, no contractors or non-residents. Proof of residency is required at the gate.', 'Free. Free mulch is available year-round for residents: bring a shovel.',
      'Saturday, November 28, 2026', 'Wednesday, December 23, 2026']) expect(t).toContain(s);
    // Every hour and every date in the meta is on the page: a change in the fields changes both.
    expect(t).toContain('Wednesdays 1 to 5 p.m.');
    expect(t).toContain('Saturdays 8 a.m. to 5 p.m.');
  });
  it('the other pages have a hand-written title (town first, no site suffix; owner order 2026-11-26 (12)) and keep their meta as it was', () => {
    const p = page('pay-water-bill');
    // 104 characters, unchanged by order: "Inget tillägg".
    expect(answerMeta(p, { siteName: 'Broomfield View', town: 'Broomfield', today: '2026-11-26' })).toEqual({
      title: 'Pay Your Broomfield Water Bill Online',
      description: "Pay Broomfield's water and sewer bill online through the city's payment portal, with no additional fees.",
    });
    expect(page('trash-recycling').title).toBe('Broomfield Trash & Recycling Guide'); // no "pickup days": the source has no common pickup day
    expect(page('snow-plowing').title).toBe('Broomfield Snow Plowing: Street Priority & Timing');
    expect(page('christmas-tree-recycling').title).toBe('Broomfield Christmas Tree Recycling 2026–27'); // still a draft
  });
  it('the facts are the source pages\' own (B3 hours and closures, B4 thresholds, B5 no fee)', () => {
    const branch = evidence('broomfield-org-2995-tree-branch-recycling.html');
    const snow = evidence('broomfield-org-1350-snow-and-ice-priority-routes.html');
    const pay = evidence('www-broomfield-org-2348-pay-online.html');
    if (!branch || !snow || !pay) return;
    for (const s of ['Wednesdays, 1-5 p.m.', 'Saturdays, 8 a.m. - 5 p.m.', 'Nov. 28 Dec. 23 Dec. 26 Jan. 2, 2027', '2990 W 124th Avenue', '303-464-5651']) expect(branch).toContain(s);
    for (const s of ['4+ inches = one lane plowed', '12+ inches = two lanes plowed', 'US 287, 120th Avenue']) expect(snow).toContain(s);
    expect(pay).toContain('Water/sewer bill payment is available online with no additional fees.');
  });
});
