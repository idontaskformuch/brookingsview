/** The weather page as data (standards: data -> what it means -> what the reader can do). One pure function turns a stored forecast
 *  (weather_snapshots.payload: periods + hourly + fetched_at, see cron-dispatcher/src/weather/) into everything the page prints: the hero
 *  (the forecast for the current hour, labelled as such), the insight lines, the next-24-hours strip, one merged row per day and the
 *  "Cloudy all week" line. The build (pages/weather.astro) and the browser (lib/live-weather.ts) both call it, so a refreshed page reads
 *  exactly like a built one.
 *
 *  No AI prose: every sentence is a template filled from fields. No data, no element: a rule whose input is missing returns nothing, and
 *  every field added after the first payload (pop, feels, gust, uv, fetched_at) is optional, so an old stored payload still renders.
 *  Nothing here knows which town or country it is: units, time formatting and coordinates come in through `WeatherEnv`. */
import type { IconName } from './ui/icons';
import { sunTimes } from './sun-times';
import { currentPeriods, daysBetween, localYMD, upcomingHours, type YMD } from './weather-format';

export interface WxPoint {
  name?: string | null;
  start: string | null;
  temp: number | null;
  unit?: string | null;
  short: string | null;
  wind: string | null;
  is_daytime: boolean | null;
  /** Optional: chance of precipitation %, "feels like" in the payload unit, gust mph, UV index. */
  pop?: number | null;
  feels?: number | null;
  gust?: number | null;
  uv?: number | null;
}

export interface WxInput {
  periods: WxPoint[];
  hourly: WxPoint[];
  /** When the forecast was fetched (ISO). Old payloads have none: the page then prints no "Updated". */
  fetchedAt?: string | null;
}

export interface WeatherEnv {
  now: Date;
  tz: string;
  unit: 'F' | 'C';
  lat: number;
  lon: number;
  /** "3pm" / "3 PM": the hour only. */
  hourLabel: (d: Date) => string;
  /** "7:12am" / "7:12 AM": with minutes. */
  clock: (d: Date) => string;
  /** The high that yesterday's stored forecast gave for yesterday, in `unit`; null/undefined when there is none. */
  yesterdayHigh?: number | null;
}

// ---- thresholds (each one is tested at its edge) ----
/** An hour counts as wet at this chance of precipitation (%) or above. */
export const WET_POP = 50;
/** A dry spell shorter than this many hours is "Dry until 3pm"; a wet spell further away than this is "Rain from 6pm". */
export const NEAR_HOURS = 6;
/** "Dry for the next N hours" is only said when the forecast covers at least this many hours. */
export const MIN_DRY_CLAIM_HOURS = 12;
/** Warmer/colder when the highs differ by at least this much, in the city's unit (2 °C is about 3.6 °F; 4 °F is the nearest whole step). */
export const TEMP_DIFF: Record<'F' | 'C', number> = { C: 2, F: 4 };
/** The feels-like temperature is only shown when it differs from the temperature by at least this many degrees. */
export const FEELS_DIFF = 2;
/** A chance of precipitation under this is not printed in the day rows. */
export const POP_SHOWN = 10;
/** The "same weather" line needs a run this long. */
export const RUN_DAYS = 3;
/** "all week" is only said when the run covers at least this many days. */
export const ALL_WEEK_DAYS = 5;

// ---- conditions ----
export type Cond = 'clear' | 'partly' | 'cloudy' | 'fog' | 'rain' | 'snow' | 'sleet' | 'thunder';

/** The source's own words ("Mostly Cloudy", "Light rain showers") to a class. null for words we do not recognise (no icon, no claim). */
export function conditionOf(short: string | null | undefined): Cond | null {
  const s = (short ?? '').toLowerCase();
  if (!s || s === '—') return null;
  if (/thunder|t-?storm|sferic/.test(s)) return 'thunder';
  if (/sleet|freezing|wintry|rain and snow|snow and rain|ice pellet|hail/.test(s)) return 'sleet';
  if (/snow|flurr|blizzard/.test(s)) return 'snow';
  if (/rain|shower|drizzle/.test(s)) return 'rain';
  if (/fog|mist|haze|smoke|dust/.test(s)) return 'fog';
  if (/partly|sunny interval|few clouds|scattered clouds/.test(s)) return 'partly';
  if (/cloud|overcast/.test(s)) return 'cloudy';
  if (/sunny|clear|fair/.test(s)) return 'clear';
  return null;
}

const ICON_DAY: Record<Cond, IconName> = { clear: 'sun', partly: 'cloudSun', cloudy: 'cloud', fog: 'fog', rain: 'rain', snow: 'snow', sleet: 'snow', thunder: 'thunder' };
const ICON_NIGHT: Record<Cond, IconName> = { ...ICON_DAY, clear: 'moon', partly: 'cloudMoon' };
export function iconFor(cond: Cond | null, daytime: boolean | null | undefined): IconName | null {
  return cond ? (daytime === false ? ICON_NIGHT : ICON_DAY)[cond] : null;
}

const ADJECTIVE: Record<Cond, string> = { clear: 'Sunny', partly: 'Partly cloudy', cloudy: 'Cloudy', fog: 'Foggy', rain: 'Rainy', snow: 'Snowy', sleet: 'Wintry', thunder: 'Stormy' };
const PRECIP_NOUN: Partial<Record<Cond, string>> = { rain: 'Rain', snow: 'Snow', sleet: 'Sleet', thunder: 'Storms' };

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SHORT = WEEKDAYS.map((d) => d.slice(0, 3));
const weekdayOf = (y: YMD) => new Date(Date.UTC(y.y, y.m - 1, y.d)).getUTCDay();
const ymdKey = (y: YMD) => `${y.y}-${String(y.m).padStart(2, '0')}-${String(y.d).padStart(2, '0')}`;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** WHO's bands. */
export function uvBand(uv: number): string {
  return uv < 3 ? 'low' : uv < 6 ? 'moderate' : uv < 8 ? 'high' : uv < 11 ? 'very high' : 'extreme';
}

// ---- view types ----
export interface HeroView {
  /** "Forecast for 2pm" (the current hour), or the period's own name ("Today") when there is no hourly point for this hour. */
  label: string;
  value: number;
  unit: 'F' | 'C';
  conditions: string | null;
  icon: IconName | null;
  /** Only when it differs from the temperature by FEELS_DIFF or more. */
  feels: number | null;
  high: number | null;
  low: number | null;
}
export interface HourView {
  start: string;
  time: string;
  temp: number;
  icon: IconName | null;
  short: string;
  pop: number | null;
  /** The hour we are in. */
  current: boolean;
}
export interface DetailView { icon?: IconName; label: string; value: string }
export interface DayView {
  key: string;
  label: string;
  fullLabel: string;
  today: boolean;
  icon: IconName | null;
  short: string;
  cond: Cond | null;
  high: number | null;
  low: number | null;
  pop: number | null;
  details: DetailView[];
}
export interface Insight { id: 'rain' | 'yesterday' | 'tomorrow'; icon: IconName; text: string }
export interface WeatherView {
  unit: 'F' | 'C';
  hero: HeroView | null;
  insights: Insight[];
  hours: HourView[];
  days: DayView[];
  scale: { min: number; max: number } | null;
  weekInsight: string | null;
  /** "10:05am", or "Thu 10:05am" when it is not from today. null without fetched_at. */
  updated: string | null;
  /** Which snapshot this was built from, so the browser can tell a newer one from the one it already shows. */
  fetchedAt: string | null;
}

// ---- rain timing ----
function isWet(h: Pick<WxPoint, 'pop' | 'short'>): boolean {
  if (isNum(h.pop)) return h.pop >= WET_POP;
  const cond = conditionOf(h.short);
  return !!cond && !!PRECIP_NOUN[cond] && !/chance|slight|isolated|scattered|possible/i.test(h.short ?? '');
}
const nounOf = (h: Pick<WxPoint, 'short'>) => PRECIP_NOUN[conditionOf(h.short) ?? 'clear'] ?? 'Precipitation';

/** "Dry until 3pm" / "Rain from 6pm" / "Rain until 3pm" / "Dry for the next 24 hours". `hours` start with the current hour. */
export function rainInsight(hours: (Pick<WxPoint, 'pop' | 'short'> & { start: string; time: string })[], env: Pick<WeatherEnv, 'now' | 'tz'>): string | null {
  if (hours.length < 2) return null;
  const when = (h: { start: string; time: string }) => {
    const sameDay = daysBetween(localYMD(env.now, env.tz), localYMD(new Date(h.start), env.tz)) === 0;
    return sameDay ? h.time : `${h.time} tomorrow`;
  };
  const wetNow = isWet(hours[0]);
  const flip = hours.findIndex((h, i) => i > 0 && isWet(h) !== wetNow);
  if (!wetNow) {
    if (flip === -1) return hours.length >= MIN_DRY_CLAIM_HOURS ? `Dry for the next ${hours.length} hours` : null;
    return flip < NEAR_HOURS ? `Dry until ${when(hours[flip])}` : `${nounOf(hours[flip])} from ${when(hours[flip])}`;
  }
  const noun = nounOf(hours[0]);
  return flip === -1 ? `${noun} for the next ${hours.length} hours` : `${noun} until ${when(hours[flip])}`;
}

// ---- the model ----
export function buildWeatherView(input: WxInput, env: WeatherEnv): WeatherView {
  const { now, tz, unit } = env;

  // days: one row per local date, day and night periods merged
  const groups = new Map<string, { ymd: YMD; day?: WxPoint; night?: WxPoint }>();
  for (const p of currentPeriods(input.periods ?? [], tz, now)) {
    if (!p.start) continue;
    const ymd = localYMD(new Date(p.start), tz);
    const g = groups.get(ymdKey(ymd)) ?? { ymd };
    if (p.is_daytime === true) g.day ??= p;
    else if (p.is_daytime === false) g.night = p;
    groups.set(ymdKey(ymd), g);
  }
  const today = localYMD(now, tz);
  const days: DayView[] = [];
  for (const [key, g] of groups) {
    const high = isNum(g.day?.temp) ? g.day!.temp : null;
    const low = isNum(g.night?.temp) ? g.night!.temp : null;
    if (high === null && low === null) continue;
    const isToday = daysBetween(today, g.ymd) === 0;
    const main = g.day ?? g.night!;
    const cond = conditionOf(main.short);
    const dow = weekdayOf(g.ymd);
    const pops = [g.day?.pop, g.night?.pop].filter(isNum);
    const popMax = pops.length ? Math.max(...pops) : null;
    const pop = popMax !== null && popMax >= POP_SHOWN ? popMax : null;
    const details: DetailView[] = [];
    const winds = [g.day?.wind, g.night?.wind].filter((w): w is string => !!w);
    if (winds.length === 2 && g.day?.wind !== g.night?.wind) details.push({ icon: 'wind', label: 'Wind', value: `${g.day!.wind} by day, ${g.night!.wind} overnight` });
    else if (winds.length) details.push({ icon: 'wind', label: 'Wind', value: winds[0] });
    const gusts = [g.day?.gust, g.night?.gust].filter(isNum);
    if (gusts.length) details.push({ label: 'Gusts', value: `up to ${Math.max(...gusts)} mph` });
    const uv = g.day?.uv;
    if (isNum(uv)) details.push({ label: 'UV index', value: `${uv} (${uvBand(uv)})` });
    const sun = sunTimes(g.ymd.y, g.ymd.m, g.ymd.d, env.lat, env.lon);
    if (sun) {
      details.push({ icon: 'sunrise', label: 'Sunrise', value: env.clock(sun.sunrise) });
      details.push({ icon: 'sunset', label: 'Sunset', value: env.clock(sun.sunset) });
    }
    days.push({
      key, label: isToday ? (g.day ? 'Today' : 'Tonight') : SHORT[dow], fullLabel: isToday ? (g.day ? 'Today' : 'Tonight') : WEEKDAYS[dow], today: isToday,
      icon: iconFor(cond, g.day ? true : false), short: main.short ?? '', cond, high, low, pop, details,
    });
  }

  const temps = days.flatMap((d) => [d.high, d.low]).filter(isNum);
  const scale = temps.length ? { min: Math.floor(Math.min(...temps)), max: Math.max(Math.ceil(Math.max(...temps)), Math.floor(Math.min(...temps)) + 1) } : null;

  // hours: the strip starts with the hour we are in
  const hours: HourView[] = upcomingHours((input.hourly ?? []).filter((h) => h.start && isNum(h.temp)), now)
    .filter((h) => new Date(h.start as string).getTime() + 3_600_000 > now.getTime())
    .map((h) => ({
      start: h.start as string, time: env.hourLabel(new Date(h.start as string)), temp: h.temp as number, icon: iconFor(conditionOf(h.short), h.is_daytime),
      short: h.short ?? '', pop: isNum(h.pop) ? h.pop : null, current: false,
    }));
  const first = hours[0];
  const covers = first && new Date(first.start).getTime() <= now.getTime();
  if (covers) first.current = true;

  // hero: the forecast for this hour (labelled), else the first period that is not over
  const todayRow = days.find((d) => d.today) ?? null;
  let hero: HeroView | null = null;
  if (covers) {
    const raw = (input.hourly ?? []).find((h) => h.start === first.start)!;
    const feels = isNum(raw.feels) && Math.abs(raw.feels - first.temp) >= FEELS_DIFF ? raw.feels : null;
    hero = { label: `Forecast for ${first.time}`, value: first.temp, unit, conditions: first.short || null, icon: first.icon, feels, high: todayRow?.high ?? null, low: todayRow?.low ?? null };
  } else if (todayRow && (todayRow.high !== null || todayRow.low !== null)) {
    const value = todayRow.high ?? (todayRow.low as number);
    hero = { label: todayRow.high !== null ? 'Today’s high' : 'Tonight’s low', value, unit, conditions: todayRow.short || null, icon: todayRow.icon, feels: null, high: todayRow.high, low: todayRow.low };
  }

  // insights
  const insights: Insight[] = [];
  const rain = covers ? rainInsight(hours, env) : null;
  if (rain) insights.push({ id: 'rain', icon: rain.startsWith('Dry') ? 'sun' : 'rain', text: rain });
  const step = TEMP_DIFF[unit];
  const todayHigh = todayRow?.high ?? null;
  if (todayHigh !== null && isNum(env.yesterdayHigh)) {
    const diff = todayHigh - env.yesterdayHigh;
    if (Math.abs(diff) >= step) insights.push({ id: 'yesterday', icon: 'thermometer', text: diff > 0 ? 'Warmer than yesterday' : 'Colder than yesterday' });
  }
  const tomorrowRow = days.find((d) => daysBetween(today, groups.get(d.key)!.ymd) === 1) ?? null;
  if (todayHigh !== null && tomorrowRow && tomorrowRow.high !== null) {
    const diff = tomorrowRow.high - todayHigh;
    if (Math.abs(diff) >= step) insights.push({ id: 'tomorrow', icon: 'thermometer', text: diff > 0 ? 'Warmer tomorrow' : 'Colder tomorrow' });
  }

  return { unit, hero, insights, hours, days, scale, weekInsight: weekInsight(days), updated: updatedLabel(input.fetchedAt, env), fetchedAt: input.fetchedAt ?? null };
}

/** "Cloudy all week" / "Rainy Tue to Thu" / "Cloudy until Thu" (a run that starts today): the longest run (>= RUN_DAYS) of the same class of weather across the day rows. */
export function weekInsight(days: Pick<DayView, 'cond' | 'label' | 'today'>[]): string | null {
  let best: { cond: Cond; from: number; to: number } | null = null;
  for (let i = 0; i < days.length; ) {
    const c = days[i].cond;
    let j = i;
    while (c && j + 1 < days.length && days[j + 1].cond === c) j++;
    if (c && j - i + 1 >= RUN_DAYS && (!best || j - i > best.to - best.from)) best = { cond: c, from: i, to: j };
    i = j + 1;
  }
  if (!best) return null;
  const covers = best.from === 0 && best.to === days.length - 1;
  if (covers && days.length >= ALL_WEEK_DAYS) return `${ADJECTIVE[best.cond]} all week`;
  return days[best.from].today ? `${ADJECTIVE[best.cond]} until ${days[best.to].label}` : `${ADJECTIVE[best.cond]} ${days[best.from].label} to ${days[best.to].label}`;
}

function updatedLabel(fetchedAt: string | null | undefined, env: WeatherEnv): string | null {
  if (!fetchedAt) return null;
  const d = new Date(fetchedAt);
  if (Number.isNaN(d.getTime())) return null;
  const same = daysBetween(localYMD(env.now, env.tz), localYMD(d, env.tz)) === 0;
  return same ? env.clock(d) : `${SHORT[weekdayOf(localYMD(d, env.tz))]} ${env.clock(d)}`;
}

/** The high that a stored (older) forecast gave for yesterday's local date: the first daytime period of that date, in the stored unit.
 *  null when the stored forecasts do not reach it (a snapshot taken after yesterday's day period was over has none). */
export function yesterdayHighFrom(snapshots: WxPoint[][], tz: string, now: Date): number | null {
  const today = localYMD(now, tz);
  for (const periods of snapshots) {
    for (const p of periods) {
      if (!p.start || p.is_daytime !== true || !isNum(p.temp)) continue;
      if (daysBetween(today, localYMD(new Date(p.start), tz)) === -1) return p.temp;
    }
  }
  return null;
}
