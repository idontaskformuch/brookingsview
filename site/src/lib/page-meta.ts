/** Sitewide title/H1/lede handoff. Single resolution helper every page
 *  template calls instead of hardcoding its own title/H1 string --
 *  mirrors the existing getCityStatus()/resolveImage() pattern: data
 *  lives in config (site/src/config/page-meta.ts), this function is the
 *  one place that turns it into real text.
 */
import { PAGE_META_PATTERNS, TOWN_OVERRIDES, type PageMetaPattern } from '../config/page-meta';
import type { SiteConfig } from './site-config';

export interface ResolvedPageMeta {
  title: string;
  h1: string;
}

function interpolate(pattern: string, vars: Record<string, string>): string {
  return pattern.replace(/\{(\w+)\}/g, (_match, token) => {
    if (!(token in vars)) {
      throw new Error(`resolvePageMeta: pattern "${pattern}" references unknown placeholder {${token}}`);
    }
    return vars[token];
  });
}

/** `routeKey` is a fixed, known key into PAGE_META_PATTERNS (e.g.
 *  'city-hall', 'facilities/detail') -- an unrecognized key is a
 *  programming error (a typo'd call site), not a normal per-town
 *  variation, so this throws rather than silently returning something
 *  hollow (same "fails loud" convention as assertAccentContrast() /
 *  validateStatusModules() elsewhere in this codebase). `extraVars`
 *  supplies any placeholder beyond {Town}/{Site} a specific pattern needs
 *  (facility detail's own {FacilityName}) -- omitted for every pattern
 *  that doesn't reference one. */
export function resolvePageMeta(
  routeKey: string,
  townConfig: Pick<SiteConfig, 'cityName' | 'siteName' | 'townId'>,
  extraVars: Record<string, string> = {},
): ResolvedPageMeta {
  const base = PAGE_META_PATTERNS[routeKey];
  if (!base) {
    throw new Error(`resolvePageMeta: no pattern registered for routeKey "${routeKey}"`);
  }
  const override = TOWN_OVERRIDES[townConfig.townId]?.[routeKey];
  const pattern: PageMetaPattern = { ...base, ...override };

  const vars = { Town: townConfig.cityName, Site: townConfig.siteName, ...extraVars };
  return {
    title: interpolate(pattern.titlePattern, vars),
    h1: interpolate(pattern.h1Pattern, vars),
  };
}
