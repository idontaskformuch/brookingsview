/** Who gets live warnings, and from where. Mirrors configs/<town>.json (data_sources.weather_alerts.area for NWS, `coordinates` for the
 *  Met Office point test); test/alerts.test.ts fails when they drift apart. */
export type AlertTown =
  | { townId: string; kind: 'nws'; zones: string[] }
  | { townId: string; kind: 'metoffice'; lat: number; lon: number };

export const ALERT_TOWNS: AlertTown[] = [
  { townId: 'brookings_sd', kind: 'nws', zones: ['SDZ040'] },
  { townId: 'moreno_valley_ca', kind: 'nws', zones: ['CAZ048', 'CAZ248'] },
  { townId: 'broomfield_co', kind: 'nws', zones: ['COZ039', 'COZ040', 'COZ239', 'COZ240'] },
  { townId: 'glasgow', kind: 'metoffice', lat: 55.8642, lon: -4.2518 },
];

/** Cron expression registered in wrangler.jsonc for this job. */
export const ALERTS_CRON = '*/15 * * * *';
