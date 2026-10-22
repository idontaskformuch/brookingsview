/**
 * Country / nation profile layer (Glasgow Phase 1). The data lives in
 * config/countries/{us,gb}.json so the Python pipeline reads the SAME files
 * (config/country_profile.py); this module is the TS side: typed access plus
 * the few formatters whose output differs per country.
 *
 * Contract: the `us` profile reproduces the pre-profile behaviour exactly.
 * Nothing here is allowed to change what a US town renders.
 */
import us from '../../../config/countries/us.json';
import gb from '../../../config/countries/gb.json';

export type CountryId = 'us' | 'gb';
export type NationId = 'scotland' | 'england';

export interface NationProfile {
  label: string;
  holidays: string[];
  sources: Record<string, string>;
}

export interface CountryProfile {
  code: string;
  id: CountryId;
  label: string;
  locale: string;
  htmlLang: string;
  ogLocale: string;
  spelling: 'american' | 'british';
  currency: string;
  currencySymbol: string;
  temperatureUnit: 'F' | 'C';
  distanceUnit: 'miles' | 'km';
  dateStyle: 'month-first' | 'day-first';
  dateExample: string;
  timeStyle: string;
  defaultTimezone: string | null;
  addressCountry: string;
  regionKind: 'state' | 'nation';
  regionRequired: boolean;
  holidays: string[];
  legal: { variant: 'us' | 'gb'; framework: string; consent: string };
  nations: Record<string, NationProfile>;
}

export const COUNTRY_PROFILES: Record<CountryId, CountryProfile> = {
  us: us as CountryProfile,
  gb: gb as CountryProfile,
};

export function countryProfile(id: CountryId | undefined): CountryProfile {
  return COUNTRY_PROFILES[id ?? 'us'];
}

/** Nation sub-profile (gb only); undefined for a country without nations. */
export function nationProfile(country: CountryId | undefined, nation: string | undefined): NationProfile | undefined {
  if (!nation) return undefined;
  return countryProfile(country).nations[nation];
}

/** Holiday ids for a town: the country's shared set plus its nation's own. */
export function holidayIdsFor(country: CountryId | undefined, nation?: string): string[] {
  return [...countryProfile(country).holidays, ...(nationProfile(country, nation)?.holidays ?? [])];
}

/** "21 October 2026" (gb) / "October 21, 2026" (us), in the given IANA zone. */
export function formatDateLong(date: Date, timeZone: string, country: CountryId | undefined): string {
  return new Intl.DateTimeFormat(countryProfile(country).locale, {
    day: 'numeric', month: 'long', year: 'numeric', timeZone,
  }).format(date);
}

/** "7pm" / "7:30pm" (decided by the owner for gb 2026-10-22; the same shape
 *  lib/time.ts already produces for US towns), in the given IANA zone. */
export function formatClockCompact(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric', minute: '2-digit', hourCycle: 'h23', timeZone,
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === 'hour')!.value) % 24;
  const minute = Number(parts.find((p) => p.type === 'minute')!.value);
  const period = hour < 12 ? 'am' : 'pm';
  const h12 = hour % 12 || 12;
  return minute === 0 ? `${h12}${period}` : `${h12}:${String(minute).padStart(2, '0')}${period}`;
}

/** Convert a Fahrenheit reading for display in the country's unit. */
export function temperatureForDisplay(fahrenheit: number, country: CountryId | undefined): number {
  if (countryProfile(country).temperatureUnit === 'F') return Math.round(fahrenheit);
  return Math.round(((fahrenheit - 32) * 5) / 9);
}

/** Minimal shape the place helpers need (SiteConfig satisfies it). */
export interface PlaceFields {
  cityName: string;
  country?: CountryId;
  stateName?: string;
  stateAbbr?: string;
  region?: string;
}

/** "Brookings, South Dakota" (us) / "Glasgow, Scotland" (gb). */
export function placeLabel(c: PlaceFields): string {
  return `${c.cityName}, ${c.stateName ?? c.region ?? ''}`.replace(/, $/, '');
}

/** "Brookings, SD" (us) / "Glasgow, Scotland" (gb). */
export function placeAbbr(c: PlaceFields): string {
  return `${c.cityName}, ${c.stateAbbr ?? c.region ?? ''}`.replace(/, $/, '');
}

/** Config gate: a us town must carry a state; a gb town must carry a region
 *  and a known nation. Returns human-readable problems (empty = valid). */
export function validatePlaceConfig(c: PlaceFields & { townId: string; nation?: string }): string[] {
  const profile = countryProfile(c.country);
  const problems: string[] = [];
  if (profile.regionRequired) {
    if (!c.stateName) problems.push(`${c.townId}: stateName is required for country ${profile.id}`);
    if (!c.stateAbbr) problems.push(`${c.townId}: stateAbbr is required for country ${profile.id}`);
  } else {
    if (!c.region) problems.push(`${c.townId}: region is required for country ${profile.id}`);
    if (!c.nation) problems.push(`${c.townId}: nation is required for country ${profile.id}`);
    else if (!profile.nations[c.nation]) problems.push(`${c.townId}: unknown nation "${c.nation}" for country ${profile.id}`);
  }
  return problems;
}
