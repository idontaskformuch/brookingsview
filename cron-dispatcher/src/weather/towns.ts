/** Where each town's forecast comes from. Mirrors configs/<town>.json (`coordinates`, `timezone`, data_sources.weather.provider);
 *  test/weather.test.ts fails when they drift apart. */
export type WeatherTown =
  | { townId: string; kind: 'nws'; lat: number; lon: number; timezone: string }
  | { townId: string; kind: 'metoffice'; lat: number; lon: number; timezone: string };

export const WEATHER_TOWNS: WeatherTown[] = [
  { townId: 'brookings_sd', kind: 'nws', lat: 44.3114, lon: -96.7984, timezone: 'America/Chicago' },
  { townId: 'moreno_valley_ca', kind: 'nws', lat: 33.9425, lon: -117.2297, timezone: 'America/Los_Angeles' },
  { townId: 'broomfield_co', kind: 'nws', lat: 39.9205, lon: -105.0866, timezone: 'America/Denver' },
  { townId: 'glasgow', kind: 'metoffice', lat: 55.8642, lon: -4.2518, timezone: 'Europe/London' },
];

/** Forecasts change about hourly: the weather job runs on the whole-hour ticks of the 15-minute cron. */
export const isWeatherTick = (scheduledTime: number): boolean => new Date(scheduledTime).getUTCMinutes() === 0;
