import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { applyHoursLinkOnly, hoursLinkOnlySlugs } from './hours-link-only';

// Owner order 2026-11-25 punkt 3. The rows are brookings_sd places 107 and 238 as they stood in the live DB that day.
const mccrory = {
  slug: 'mccrory-gardens',
  hours_text: 'Summer: Sun–Sat 10am–7pm (last admission 6:30pm); Fall/Winter: Mon–Fri 10am–5pm (last admission 4:30pm). Extended hours for special events and holiday shopping.',
  hours_structured: null,
  source_url: 'https://www.sdstate.edu/mccrory-gardens/plan-your-visit-mccrory',
  website: 'https://www.sdstate.edu/mccrory-gardens',
};
const museum = {
  slug: 'childrens-museum-of-south-dakota',
  hours_text: "Open 10 a.m.-5 p.m.; see the museum's Hours + Admission page for which days.",
  hours_structured: null,
  source_url: 'https://prairieplay.org/hours-admission/',
  website: 'https://prairieplay.org/',
};

describe('applyHoursLinkOnly', () => {
  it('drops our own wording for McCrory Gardens and links to its plan-your-visit page', () => {
    const f = applyHoursLinkOnly('brookings_sd', mccrory);
    expect(f.hours_text).toBeNull();
    expect(f.hours_structured).toBeNull();
    expect(f.hours_link).toEqual({ label: "Hours on McCrory Gardens' website", url: mccrory.source_url });
  });

  it("drops our own wording for the Children's Museum and links to its Hours + Admission page", () => {
    const f = applyHoursLinkOnly('brookings_sd', museum);
    expect(f.hours_text).toBeNull();
    expect(f.hours_link).toEqual({ label: "Hours on the Children's Museum's website", url: museum.source_url });
  });

  it('falls back to the website when the row has no source_url (row 107 with source_url the only changed field)', () => {
    expect(applyHoursLinkOnly('brookings_sd', { ...mccrory, source_url: null }).hours_link?.url).toBe(mccrory.website);
  });

  it('leaves every other row, and the same slug in another town, unchanged', () => {
    const other = { ...mccrory, slug: 'rotary-park', hours_text: 'Sunrise to 11:00 p.m.' }; // rotary-park's catalog text, 2026-11-25
    expect(applyHoursLinkOnly('brookings_sd', other)).toEqual({ ...other, hours_link: null });
    expect(applyHoursLinkOnly('broomfield_co', mccrory)).toEqual({ ...mccrory, hours_link: null });
    expect(hoursLinkOnlySlugs('broomfield_co')).toEqual([]);
  });

  it('is applied by both facility loaders and both place_hours readers in lib/db.ts', () => {
    const src = readFileSync(fileURLToPath(new URL('./db.ts', import.meta.url)), 'utf-8');
    const body = (fn: string) => src.slice(src.indexOf(`export async function ${fn}(`)).split('\n}\n')[0];
    for (const fn of ['getFacilities', 'getFacilityBySlug']) expect(body(fn), fn).toContain('applyHoursLinkOnly(TOWN_ID');
    for (const fn of ['getAllPlaceHoursForTown', 'getPlaceHours']) expect(body(fn), fn).toContain('hoursLinkOnlySlugs(TOWN_ID)');
  });
});
