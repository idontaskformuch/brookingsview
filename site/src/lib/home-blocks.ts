/** Pure helpers for the front page's section blocks (Fas 2, front page as a hub). Every rule is tested in home-blocks.test.ts. */
import { pickFromPool, type ImageRef } from './images';
import type { Game, RegionalGame, TrafficIncident, SchoolAlert } from './db';
import { daysBetween, type MeetingView } from './meetings-view';
import { teamLabel } from './jackrabbits-view';
import { trafficKind } from './traffic';
import { latestFinal, scoreLine } from './rail';
import { ymd } from './sports-season';

export interface BlockImage { path: string; alt: string; width: number; height: number }
export interface BlockItem {
  href: string;
  title: string;
  /** Small line above the title ("Fri, Nov 20", "Home · Football"). */
  kicker?: string;
  /** Line under the title (venue, time). */
  meta?: string;
  /** Town-local day ("YYYY-MM-DD") the browser turns into " · in 5 days" after `meta` (lib/client/time-status.ts, Fas 3: never at build). */
  relDay?: string;
  image?: BlockImage | null;
  /** List variant: a date box (three-letter weekday or month + day of month). */
  date?: { top: string; day: string };
}


/** Images already shown on the page (the lead, the secondaries, earlier cards): a pool pick never repeats one of them (owner 2026-11-19:
 *  no two identical images visible at once). Returns null for an empty pool or one whose every photo is already on the page. The pick is
 *  added to `used`. */
export function pickCategoryImage(pool: ImageRef[] | undefined, seed: string, used: Set<string>): ImageRef | null {
  if (!pool || pool.length === 0) return null;
  const img = pickFromPool(pool, seed, { exclude: used, getKey: (i) => i.path });
  if (used.has(img.path)) return null;
  used.add(img.path);
  return img;
}

/** The first pool in `pools` (in order) that still has a photo not on the page. */
export function pickFromPools(pools: (ImageRef[] | undefined)[], seed: string, used: Set<string>): ImageRef | null {
  for (const pool of pools) {
    const img = pickCategoryImage(pool, seed, used);
    if (img) return img;
  }
  return null;
}

/** A date box: the three-letter month (or weekday) and the day of the month, in the town's zone. */
export function dateBox(iso: string, tz: string, locale: 'en-US' | 'en-GB', top: 'month' | 'weekday' = 'weekday'): { top: string; day: string } {
  const d = new Date(iso);
  const opt: Intl.DateTimeFormatOptions = top === 'month' ? { month: 'short', timeZone: tz } : { weekday: 'short', timeZone: tz };
  return { top: new Intl.DateTimeFormat(locale, opt).format(d), day: new Intl.DateTimeFormat(locale, { day: 'numeric', timeZone: tz }).format(d) };
}

/** The first `n` items whose key has not been seen (a film listed by two sources, a recurring event's copies). */
export function distinctBy<T>(items: T[], key: (t: T) => string, n: number): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const it of items) {
    const k = key(it).trim().toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(it);
    if (out.length >= n) break;
  }
  return out;
}

const timeOf = (iso: string, tz: string, locale: 'en-US' | 'en-GB') => new Date(iso).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit', timeZone: tz });
const ymdOf = (iso: string, tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));

/** Sports block (list): the next games (up to 3), then the latest result inside OFF_SEASON_DAYS. Program games (`games`, sport_events) first;
 *  a town without them uses its regional teams (primary tier). Nothing scheduled and no recent result: no items (the block is not shown). */
export function sportsItems(o: { games: Game[]; regional: RegionalGame[]; todayYmd: string; tz: string; locale: 'en-US' | 'en-GB'; teamName: string; drawLetter: 'D' | 'T' }): BlockItem[] {
  const out: BlockItem[] = [];
  if (o.games.length > 0) {
    const coming = o.games.filter((g) => (g.phase === 'upcoming' || g.phase === 'inProgress') && g.starts_at).slice(0, 3);
    for (const g of coming) {
      out.push({
        href: '/jackrabbits/', title: `${g.home_away === 'away' ? 'at' : 'vs'} ${g.opponent}`,
        kicker: `${teamLabel(g.sport)} · ${g.home_away === 'home' ? 'Home' : g.home_away === 'neutral' ? 'Neutral site' : 'Away'}`,
        meta: g.time_tba ? 'Time TBA' : timeOf(g.starts_at!, o.tz, o.locale), date: dateBox(g.starts_at!, o.tz, o.locale),
      });
    }
    const last = o.games.filter((g) => g.result && g.starts_at && daysBetween(ymdOf(g.starts_at, o.tz), o.todayYmd) <= 14 && daysBetween(ymdOf(g.starts_at, o.tz), o.todayYmd) >= 0)
      .sort((a, b) => b.starts_at!.localeCompare(a.starts_at!))[0];
    if (last) out.push({ href: '/jackrabbits/', title: `${last.result} ${last.home_away === 'away' ? 'at' : 'vs'} ${last.opponent}`, kicker: `${teamLabel(last.sport)} · Result`, date: dateBox(last.starts_at!, o.tz, o.locale) });
    return out;
  }
  const primary = o.regional.filter((g) => g.relevance_tier === 'primary');
  // game_date is a DATE: the driver gives a string or a local-midnight Date (ymd() reads either without a zone shift).
  const day = (g: RegionalGame) => (g.game_date ? ymd(g.game_date as string | Date) : '');
  const coming = primary.filter((g) => g.status !== 'final' && day(g) >= o.todayYmd).sort((a, b) => day(a).localeCompare(day(b))).slice(0, 3);
  for (const g of coming) {
    out.push({
      href: '/sports/', title: `${g.team_name} ${g.home_away === 'home' ? 'vs' : 'at'} ${g.opponent_name}`, kicker: g.league.toUpperCase(),
      meta: g.game_time_utc ? timeOf(g.game_time_utc, o.tz, o.locale) : undefined, date: dateBox(`${day(g)}T12:00:00Z`, 'UTC', o.locale),
    });
  }
  const last = latestFinal(primary, o.todayYmd);
  if (last) out.push({ href: '/sports/', title: `${last.team_name} ${scoreLine(last.team_score!, last.opponent_score!, o.drawLetter)} ${last.home_away === 'home' ? 'vs' : 'at'} ${last.opponent_name}`, kicker: `${last.league.toUpperCase()} · Result`, date: dateBox(`${day(last)}T12:00:00Z`, 'UTC', o.locale) });
  return out;
}

/** City Hall block (list): the next meetings (up to 3) and the latest decision. */
export function cityHallItems(o: { meetings: MeetingView[]; todayYmd: string; locale: 'en-US' | 'en-GB'; decision: { href: string; title: string; meta: string; ymd: string } | null }): BlockItem[] {
  const out: BlockItem[] = o.meetings.slice(0, 3).map((m) => ({
    href: `/city-hall/#meeting-${m.id}`, title: m.bodyLabel + (m.typeLabel ? ` · ${m.typeLabel}` : ''),
    meta: [m.time, m.items.length > 0 ? `${m.items.length} agenda ${m.items.length === 1 ? 'item' : 'items'}` : null].filter(Boolean).join(' · '),
    date: dateBox(`${m.ymd}T12:00:00Z`, 'UTC', o.locale), relDay: m.ymd,
  }));
  if (o.decision) out.push({ href: o.decision.href, title: o.decision.title, kicker: 'Decided', meta: o.decision.meta, date: dateBox(`${o.decision.ymd}T12:00:00Z`, 'UTC', o.locale) });
  return out;
}

/** Getting around block (list): active traffic incidents and closures (up to 3), then school closures. */
export function gettingAroundItems(o: { traffic: TrafficIncident[]; schoolClosures: SchoolAlert[]; tz: string; locale: 'en-US' | 'en-GB' }): BlockItem[] {
  const t = o.traffic.slice(0, 3).map((r): BlockItem => ({
    href: '/traffic/', title: r.title, kicker: trafficKind(r) === 'closure' ? 'Closure' : 'Incident',
    meta: [r.road, r.ends_at ? `until ${new Date(r.ends_at).toLocaleString(o.locale, { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: o.tz })}` : null].filter(Boolean).join(' · ') || undefined,
  }));
  const s = o.schoolClosures.filter((a) => a.is_closure).slice(0, 4 - t.length).map((a): BlockItem => ({
    href: '/closures/', title: a.title ?? a.message, kicker: `School · ${a.district}`, date: dateBox(a.posted_at, o.tz, o.locale),
  }));
  return [...t, ...s];
}
