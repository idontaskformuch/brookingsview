/** Heat/dust advisory tier logic for Worker Pulse (Moreno Valley only, see
 *  workplace-watch/index.astro's own comment on why -- shift/warehouse
 *  framing fits Moreno Valley's employer set, not Broomfield's corporate-HQ
 *  one; not a data-availability gap).
 *
 *  Extracted from HeatAdvisoryWidget.astro (CityStatus's `worker_pulse`
 *  module needs the exact same tier decision, see lib/cityStatus.ts) so
 *  there is one set of thresholds, not two copies that can drift apart.
 */
export type HeatTier = 'safe' | 'caution' | 'high-risk';

export interface HeatAdvisory {
  tier: HeatTier;
  label: string;
}

export function computeHeatTier(tempF: number | null, activeAlertTitles: string[]): HeatAdvisory {
  const heatAlert = activeAlertTitles.find((t) =>
    /excessive heat|heat warning|heat advisory|extreme heat/i.test(t));
  const dustAlert = activeAlertTitles.find((t) => /dust/i.test(t));

  if (heatAlert) return { tier: 'high-risk', label: heatAlert };
  if (dustAlert) return { tier: 'caution', label: dustAlert };
  if (tempF !== null && tempF >= 105) {
    return { tier: 'high-risk', label: `${Math.round(tempF)}°F -- high heat risk` };
  }
  if (tempF !== null && tempF >= 90) {
    return { tier: 'caution', label: `${Math.round(tempF)}°F -- use caution outdoors` };
  }
  return {
    tier: 'safe',
    label: tempF !== null ? `${Math.round(tempF)}°F -- safe conditions` : 'No advisory in effect',
  };
}

export const HEAT_TIER_TEXT: Record<HeatTier, string> = {
  safe: 'Safe',
  caution: 'Caution',
  'high-risk': 'High risk',
};
