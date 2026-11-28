/** /help/ page model (spec .claude/specs/help-resources.md Phase 3): rows from db.getHelpEntries -> sections of cards. Pure; no town
 *  branches (standard-layout test), the differences are the town's country (clock style, date order) and config. What is shown is
 *  decided by lib/help-visibility.ts helpVisible, the mirror of the alarm's count (db/help_places.py). */
import type { HelpClosedRow, HelpEntryRow, HelpHoursRow } from './db';
import { helpVisible } from './help-visibility';
import { daysCompact, shortDate, timesCompact } from './answer-facility';
import { facilityMapLink } from './facility-lede';
import { postalDistrict } from './help-geo';

export { distanceKm, outcodeOrder, postalDistrict, sortByDistance } from './help-geo';

export interface HelpInput { entries: (HelpEntryRow & { place_id: number })[]; hours: HelpHoursRow[]; closed: HelpClosedRow[] }
export type HelpSectionId = 'food' | 'winter' | 'bills';

export interface HelpCard {
  key: string;
  name: string;
  /** The postal district: what the "By area" grouping uses (owner 2026-11-28: always the district). */
  area: string | null;
  /** The group's heading: "G40 · Bridgeton" when the row has an area_name, else the district alone. */
  areaLabel: string | null;
  district: string | null;
  postcode: string | null;
  /** The building the help is in, when the source names one ("Ibrox Parish Church"). */
  place: string | null;
  address: string | null;
  mapHref: string | null;
  phone: string | null;
  lat: number | null;
  lon: number | null;
  /** Weekly hours, one line per time window ("Mon–Fri" "8:30–9:30am"); weekdays 0=Sun..6=Sat for the browser's today mark. */
  weekly: { days: string; time: string; weekdays: number[] }[];
  openDays: number[];
  /** Dated sessions (from a monthly rule) from today on, at most NEXT_DATES. */
  next: { ymd: string; label: string }[];
  /** The source's own words for the schedule: a role's schedule_text, a place's schedule_rule is not read here (its dates are). */
  scheduleText: string | null;
  closedNext: string | null;
  requirements: string | null;
  sourceHref: string;
  sourceHost: string;
  checked: string;
}
export interface HelpSection { id: HelpSectionId; title: string; cards: HelpCard[] }

export const NEXT_DATES = 3;
const SECTION_OF: Record<string, HelpSectionId> = { food_pantry: 'food', meal_program: 'food', warm_space: 'winter', assistance_program: 'bills' };
const SECTIONS: { id: HelpSectionId; title: string }[] = [
  { id: 'food', title: 'Food' },
  { id: 'winter', title: 'Winter help' },
  { id: 'bills', title: 'Help with bills & rent' },
];

const hhmm = (t: string) => t.slice(0, 5);
/** The earliest of the days in a Monday-first week (0=Sun is 6). */
const firstDay = (days: number[]) => Math.min(...days.map((d) => (d + 6) % 7));
const host = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };

function card(e: HelpEntryRow & { place_id: number }, hours: HelpHoursRow[], closed: HelpClosedRow[], today: string, country: 'us' | 'gb'): HelpCard {
  const own = e.role ? [] : hours.filter((h) => h.place_id === e.place_id);
  const weeklyRows = own.filter((h) => h.valid_from === null && h.opens && h.closes);
  const byTime = new Map<string, number[]>();
  for (const h of [...weeklyRows].sort((a, b) => a.opens!.localeCompare(b.opens!))) {
    const k = `${hhmm(h.opens!)}|${hhmm(h.closes!)}`;
    byTime.set(k, [...(byTime.get(k) ?? []), h.day_of_week]);
  }
  const weekly = [...byTime].map(([k, days]) => {
    const [from, to] = k.split('|');
    const d = [...new Set(days)];
    return { days: d.length === 7 ? 'Daily' : daysCompact(d), time: timesCompact(from, to, country), weekdays: d, from };
  }).sort((a, b) => firstDay(a.weekdays) - firstDay(b.weekdays) || a.from.localeCompare(b.from))
    .map(({ from: _from, ...w }) => w);
  const dayOnly = own.filter((h) => h.valid_from === null && h.time_unknown).map((h) => h.day_of_week);
  for (const d of [...new Set(dayOnly)]) weekly.push({ days: daysCompact([d]), time: '', weekdays: [d] });
  const next = own.filter((h) => h.valid_from !== null && h.valid_from >= today && (h.opens || h.time_unknown))
    .sort((a, b) => a.valid_from!.localeCompare(b.valid_from!) || (a.opens ?? '').localeCompare(b.opens ?? ''))
    .slice(0, NEXT_DATES)
    .map((h) => ({ ymd: h.valid_from!, label: `${shortDate(h.valid_from!, country)}${h.opens && h.closes ? ` · ${timesCompact(hhmm(h.opens), hhmm(h.closes), country)}` : ''}` }));
  const district = postalDistrict(e.postal_code);
  const address = e.address ? [e.address, e.postal_code].filter(Boolean).join(', ') : null;
  const closedNext = closed.find((c) => c.place_id === e.place_id && c.date >= today)?.date ?? null;
  return {
    key: e.key, name: e.name, area: district, areaLabel: district && e.area_name ? `${district} · ${e.area_name}` : district, district, postcode: e.postal_code, place: e.location_note, address,
    mapHref: facilityMapLink(e.lat, e.lon, address), phone: e.phone, lat: e.lat, lon: e.lon,
    weekly, openDays: [...new Set(weekly.flatMap((w) => w.weekdays))].sort(), next,
    scheduleText: e.role ? e.schedule_text : null,
    closedNext: closedNext ? shortDate(closedNext, country) : null,
    requirements: e.requirements_note, sourceHref: e.source_url, sourceHost: host(e.source_url),
    checked: e.verified_date ? `Checked ${shortDate(e.verified_date.slice(0, 10), country)}` : '',
  };
}

/** The page's sections in spec order, each left out when empty; cards by name. */
export function helpSections(input: HelpInput, today: string, country: 'us' | 'gb'): HelpSection[] {
  const shown = input.entries.filter((e) => helpVisible(e, today));
  return SECTIONS.map((s) => ({
    ...s,
    cards: shown.filter((e) => SECTION_OF[e.role ?? e.category] === s.id)
      .map((e) => card(e, input.hours, input.closed, today, country))
      .sort((a, b) => a.name.localeCompare(b.name)),
  })).filter((s) => s.cards.length > 0);
}

/** Districts in postcode order: letters, then the number ("G2" < "G40" < "G51"); a ZIP sorts as a number. */
export const districtCompare = (a: string, b: string): number => a.localeCompare(b, 'en', { numeric: true });

/** The distinct districts of the cards with their label, in postcode order; the "By area" toggle is offered at two or more. A
 *  district whose cards disagree on the label (one has an area_name, one has not) takes the first label with an area name. */
export function helpAreas(cards: HelpCard[]): { key: string; label: string }[] {
  const out = new Map<string, string>();
  for (const c of cards) {
    if (!c.area) continue;
    const label = c.areaLabel ?? c.area;
    if (!out.has(c.area) || out.get(c.area) === c.area) out.set(c.area, label);
  }
  return [...out].sort((a, b) => districtCompare(a[0], b[0])).map(([key, label]) => ({ key, label }));
}

/** Area distribution for the build log (spec: evaluate area pages later; no area pages now). */
export function areaDistribution(cards: HelpCard[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of cards) out[c.area ?? '(none)'] = (out[c.area ?? '(none)'] ?? 0) + 1;
  return out;
}

/** Where the cards' coordinates come from (scrapers/help_geocode.py), for the About section's attribution: postcodes.io for a UK
 *  postcode (OS / Royal Mail / ONS open data), OpenStreetMap geocoding for a US address; only the sources the shown cards use. */
export function coordinateSources(cards: HelpCard[]): { name: string; href: string; note: string }[] {
  const located = cards.filter((c) => c.lat != null && c.lon != null);
  const uk = located.some((c) => c.postcode && postalDistrict(c.postcode) !== c.postcode.trim());
  const us = located.some((c) => !(c.postcode && postalDistrict(c.postcode) !== c.postcode.trim()));
  return [
    ...(uk ? [{ name: 'postcodes.io', href: 'https://postcodes.io/', note: 'Contains OS data © Crown copyright and database right; Royal Mail data © Royal Mail copyright and database right; source: Office for National Statistics' }] : []),
    ...(us ? [{ name: 'OpenStreetMap', href: 'https://www.openstreetmap.org/copyright', note: '© OpenStreetMap contributors' }] : []),
  ];
}

/** ItemList of the shown places (spec SEO: "ItemList of places where valid"; no FAQ schema). */
export function helpItemListJsonLd(sections: HelpSection[], locality: string) {
  const cards = sections.flatMap((s) => s.cards);
  return {
    '@context': 'https://schema.org', '@type': 'ItemList',
    itemListElement: cards.map((c, i) => ({
      '@type': 'ListItem', position: i + 1,
      item: { '@type': 'Place', name: c.name,
        ...(c.address ? { address: { '@type': 'PostalAddress', streetAddress: c.address.replace(c.postcode ? `, ${c.postcode}` : '', ''), ...(c.postcode ? { postalCode: c.postcode } : {}), addressLocality: locality } } : {}) },
    })),
  };
}
