import type { CountryId, NationId } from './country-profile';

export interface TownIdentity {
  townId: string;
  cityName: string;
  siteName: string;
  domain: string;
  siteUrl: string;
  timezone: string;
  country: CountryId;
  nation?: NationId;
  noindexSite: boolean;
}
export const TOWN_REGISTRY: Record<string, TownIdentity>;
