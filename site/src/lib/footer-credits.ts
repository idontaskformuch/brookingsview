/**
 * Footer credit lines a town's sources ask for or the owner wants, derived from the town's own `sports` config so they cannot drift:
 * a town whose `sports.enabled` is true and that has a `sportmonks` source gets "Data provided by Sportmonks" (the terms do not require it; the owner keeps it, ticket Sportmonks-114845).
 * Text only: Sportmonks logos and photos are not allowed.
 */
import brookingsConfig from '../../../configs/brookings_sd.json';
import morenoValleyConfig from '../../../configs/moreno_valley_ca.json';
import broomfieldConfig from '../../../configs/broomfield_co.json';
import glasgowConfig from '../../../configs/glasgow.json';

const CONFIGS: Record<string, any> = {
  brookings_sd: brookingsConfig,
  moreno_valley_ca: morenoValleyConfig,
  broomfield_co: broomfieldConfig,
  glasgow: glasgowConfig,
};

const CREDIT_BY_ADAPTER: Record<string, string> = { sportmonks: 'Data provided by Sportmonks' };

export function footerCredits(townId: string, configs: Record<string, any> = CONFIGS): string[] {
  const sports = configs[townId]?.sports;
  if (sports?.enabled !== true) return []; // credit only while the data is actually shown
  const sources: any[] = sports.sources ?? [];
  const out = sources.map((s) => CREDIT_BY_ADAPTER[s?.adapter]).filter((c): c is string => Boolean(c));
  return [...new Set(out)];
}
