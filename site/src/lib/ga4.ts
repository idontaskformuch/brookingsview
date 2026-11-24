/** GA4 consent mode per country (owner 2026-11-24). A town with no ga4MeasurementId renders no GA4 script and no banner of its own, and the
 *  build carries on. The ONE thing that stops the build: a UK town with an id while its country profile is not in opt-in mode, because then
 *  GA4 would load before the visitor has agreed (PECR). */
import { countryProfile, type CountryId } from './country-profile';

/** Opt-in = GA4 loads only after "Accept" (config/countries/<id>.json legal.consent starts with "opt-in"); otherwise the opt-out gate. */
export function ga4NeedsOptIn(country: CountryId): boolean {
  return countryProfile(country).legal.consent.startsWith('opt-in');
}

/** Why this build must stop, or null. Only gb + an id + no opt-in mode. */
export function ga4GuardProblem(country: CountryId, id: string | undefined, optIn: boolean): string | null {
  if (country === 'gb' && id && !optIn) return 'a UK town has a GA4 id but its country profile is not in opt-in mode (GA4 would load before consent, PECR)';
  return null;
}
