/** The ONE rule for what a sport_events row is "right now" and what counts towards a record. Used by /jackrabbits and the front page;
 *  nothing else decides upcoming / in progress / pending / history (owner 2026-11-08).
 *
 *  - upcoming:   status 'scheduled' and it has not started. A time_tba game stays upcoming through its local day.
 *  - inProgress: start <= now < start + typical_duration_hours (config/sports.json, default 4). The word is "In progress", never "Live":
 *                we have no live data and show no live score. A time_tba game is never in progress (its clock time is unknown).
 *  - pending:    'scheduled', past its window, still the same local day, no result -> "Result pending" until the local day ends.
 *  - history:    everything else. A 'scheduled' row that has outlived its day is history and is never shown as upcoming.
 *  - record:     only status 'final' AND NOT exhibition. An exhibition keeps its score on screen but is never counted.
 *  - season:     the academic year, 1 Aug - 31 Jul in the sport's local time. Rows outside the current one are not shown. */

import { sportDurationHours } from "./sports-registry.generated";

export interface SportEventLike {
  sport: string;
  startAt: Date;
  tz: string;
  status: "scheduled" | "final" | "postponed" | "cancelled";
  timeTba: boolean;
  exhibition: boolean;
  scoreHome: number | null;
  scoreAway: number | null;
  homeProgramId: string | null;
  awayProgramId: string | null;
}

/** A sport_events row as the pages read it. */
export interface SportEventRow extends SportEventLike {
  id: number;
  gender: string | null;
  neutralSite: boolean;
  venue: string | null;
  homeName: string | null;
  awayName: string | null;
}

export type SportPhase = "upcoming" | "inProgress" | "pending" | "history";

const parts = (d: Date, tz: string) => {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const o: Record<string, number> = {};
  for (const p of f.formatToParts(d)) if (p.type !== "literal") o[p.type] = Number(p.value);
  return o;
};

/** The instant the local calendar day containing `d` ends (= the next local midnight), in `tz`. */
export function localDayEnd(d: Date, tz: string): Date {
  const p = parts(d, tz);
  const target = Date.UTC(p.year, p.month - 1, p.day + 1);
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const q = parts(new Date(guess), tz);
    guess += target - Date.UTC(q.year, q.month - 1, q.day, q.hour, q.minute, q.second);
  }
  return new Date(guess);
}

export function sportEventEnd(ev: Pick<SportEventLike, "sport" | "startAt" | "tz" | "timeTba">): Date {
  return ev.timeTba ? localDayEnd(ev.startAt, ev.tz) : new Date(ev.startAt.getTime() + sportDurationHours(ev.sport) * 3600_000);
}

export function sportPhase(ev: SportEventLike, now: Date): SportPhase {
  if (ev.status !== "scheduled") return "history";
  const dayEnd = localDayEnd(ev.startAt, ev.tz).getTime();
  const t = now.getTime();
  if (ev.timeTba) return t < dayEnd ? "upcoming" : "history";
  if (t < ev.startAt.getTime()) return "upcoming";
  if (t < sportEventEnd(ev).getTime()) return "inProgress";
  return t < dayEnd ? "pending" : "history";
}

/** Not yet over: what a "next up" / schedule list may show. */
export const isOpen = (phase: SportPhase): boolean => phase === "upcoming" || phase === "inProgress" || phase === "pending";

/** The current season as [start, end): 1 Aug of the season's first year in `tz`, to 1 Aug a year later. */
export function currentSeason(now: Date, tz: string): { start: Date; end: Date; label: string } {
  const p = parts(now, tz);
  const y = p.month >= 8 ? p.year : p.year - 1;
  const aug1 = (year: number) => localDayEnd(new Date(Date.UTC(year, 6, 31, 12)), tz); // end of 31 Jul = 1 Aug 00:00 local
  return { start: aug1(y), end: aug1(y + 1), label: `${y}-${String((y + 1) % 100).padStart(2, "0")}` };
}

export const inSeason = (ev: Pick<SportEventLike, "startAt" | "tz">, now: Date): boolean => {
  const s = currentSeason(now, ev.tz);
  return ev.startAt >= s.start && ev.startAt < s.end;
};

export const countsInRecord = (ev: Pick<SportEventLike, "status" | "exhibition">): boolean => ev.status === "final" && !ev.exhibition;

export interface SportRecord { wins: number; losses: number; ties: number }

/** Our side's record. `programId` is the program whose record this is; rows where it plays neither side or has no score are skipped. */
export function recordFor(events: SportEventLike[], programId: string): SportRecord {
  const r: SportRecord = { wins: 0, losses: 0, ties: 0 };
  for (const ev of events) {
    if (!countsInRecord(ev) || ev.scoreHome == null || ev.scoreAway == null) continue;
    const ours = ev.homeProgramId === programId ? ev.scoreHome : ev.awayProgramId === programId ? ev.scoreAway : null;
    if (ours == null) continue;
    const theirs = ev.homeProgramId === programId ? ev.scoreAway : ev.scoreHome;
    if (ours > theirs) r.wins++; else if (ours < theirs) r.losses++; else r.ties++;
  }
  return r;
}

/** "W 91-62" from `programId`'s side, or null while there is no score for it. */
export function resultLine(ev: SportEventLike, programId: string): string | null {
  if (ev.status !== "final" || ev.scoreHome == null || ev.scoreAway == null) return null;
  const homeSide = ev.homeProgramId === programId;
  if (!homeSide && ev.awayProgramId !== programId) return null;
  const ours = homeSide ? ev.scoreHome : ev.scoreAway;
  const theirs = homeSide ? ev.scoreAway : ev.scoreHome;
  return `${ours > theirs ? "W" : ours < theirs ? "L" : "T"} ${ours}-${theirs}`;
}
