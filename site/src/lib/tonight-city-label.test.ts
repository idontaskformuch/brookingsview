import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import TonightRows from '../components/tonight/TonightRows.astro';
import type { EveningEntry } from './evening-items';
import { eventCityLabel, type CardTown } from './tonight-cards';

// Owner 2026-11-09: the city label ("Denver · 15 mi") on /tonight rows came off in the date-tile rollout and was put back. These fail if a big show loses it again.
const BROOMFIELD = { lat: 39.9205, lon: -105.0866 };
const town: CardTown = { country: 'us', homeCity: 'Broomfield', center: BROOMFIELD, hidePrice: true, cityLabels: true, bigShows: true };
const entry = (id: string, o: Partial<EveningEntry> = {}): EveningEntry => ({
  id, title: `Show ${id}`, start: '2026-11-10T01:00:00.000Z', end: null, group: 'Live music', labels: [], venue: 'Venue', href: `/s/${id}/`, source: 'own',
  distanceMiles: null, driveMinutes: null, checked: '2026-11-09', ...o,
});
const BIG = entry('big', { source: 'ticketmaster', venueCity: 'Denver', lat: 39.7392, lon: -104.9903, distanceMiles: 15, driveMinutes: 25 });
const LOCAL = entry('local', { venueCity: 'Broomfield', lat: 39.92, lon: -105.08, driveMinutes: 5 });

async function render(entries: EveningEntry[], t: CardTown = town): Promise<string> {
  const c = await AstroContainer.create();
  return c.renderToString(TonightRows, { props: { id: 'tn-tonight', entries, late: [], tz: 'America/Denver', regions: {}, town: t, osmChecked: '2026-11-09', tonight: true } });
}
const rowOf = (html: string, id: string) => html.split('<li ').find((c) => new RegExp(`^[^>]*data-id="?${id}"?[ >]`).test(c))?.split('</li>')[0] ?? '';

describe('city label on the /tonight event rows', () => {
  it('a big show row shows "Denver · N mi" with the straight-line tooltip, and no drive time beside it', async () => {
    const row = rowOf(await render([BIG, LOCAL]), 'big');
    expect(row).toMatch(/class="pl__meta pl__city"[^>]*>Denver · \d+ mi</);
    expect(row).toMatch(/title="About \d+ miles in a straight line/);
    expect(row).not.toMatch(/about 25 min/i);
  });
  it('a local event in the home town gets no label', async () => {
    expect(rowOf(await render([BIG, LOCAL]), 'local')).not.toContain('pl__city');
  });
  it('a big show in the home city still gets one ("Broomfield · <1 mi"); a non-big event outside town gets the plain city label', async () => {
    const home = entry('bh', { source: 'ticketmaster', venueCity: 'Broomfield', lat: 39.9205, lon: -105.0866 });
    const boulder = entry('bo', { venueCity: 'Boulder', lat: 40.015, lon: -105.2705 });
    const html = await render([home, boulder]);
    expect(rowOf(html, 'bh')).toMatch(/pl__city[^>]*>Broomfield · &lt;1 mi</);
    expect(rowOf(html, 'bo')).toMatch(/pl__city[^>]*>Boulder · \d+ mi</);
  });
  it('towns without cityLabels print no label and keep distance and drive time', async () => {
    const t = { ...town, cityLabels: false };
    expect(eventCityLabel(BIG, t)).toBeNull();
    const row = rowOf(await render([BIG], t), 'big');
    expect(row).not.toContain('pl__city');
    expect(row).toMatch(/15 mi/);
  });
  it('the Up next list on the page passes the label too', () => {
    expect(readFileSync(new URL('../pages/tonight.astro', import.meta.url), 'utf8')).toMatch(/eveningPopDays\(upNext.*eventCityLabel/);
  });
});
