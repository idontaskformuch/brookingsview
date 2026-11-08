/** The ONE rule for what a sport_events row is "right now" and what counts towards a record. Used by /jackrabbits and the front page;
 *  nothing else decides upcoming / pending / history (owner 2026-11-08).
 *
 *  - upcoming: status 'scheduled' and its end is after now. A timed game ends typical_duration_hours (config/sports.json, default 4) after it starts (the table has no end
 *    time); a time_tba game ends at the end of its local day.
 *  - pending:  'scheduled', past its end, still the same local day, no result -> "Result pending" until the local day ends.
 *  - history:  everything else. A 'scheduled' row that has outlived its day is history and is never shown as upcoming.
 *  - record:   only status 'final' AND NOT exhibition. An exhibition keeps its score on screen but is never counted. */

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

export type SportPhase = "upcoming" | "pending" | "history";

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
  if (sportEventEnd(ev).getTime() > now.getTime()) return "upcoming";
  return now.getTime() < localDayEnd(ev.startAt, ev.tz).getTime() ? "pending" : "history";
}

export const countsInRecord = (ev: Pick<SportEventLike, "status" | "exhibition">): boolean => ev.status === "final" && !ev.exhibition;

export interface Record { wins: number; losses: number; ties: number }

/** Our side's record. `programId` is the program whose record this is; rows where it plays neither side or has no score are skipped. */
export function recordFor(events: SportEventLike[], programId: string): Record {
  const r: Record = { wins: 0, losses: 0, ties: 0 };
  for (const ev of events) {
    if (!countsInRecord(ev) || ev.scoreHome == null || ev.scoreAway == null) continue;
    const ours = ev.homeProgramId === programId ? ev.scoreHome : ev.awayProgramId === programId ? ev.scoreAway : null;
    if (ours == null) continue;
    const theirs = ev.homeProgramId === programId ? ev.scoreAway : ev.scoreHome;
    if (ours > theirs) r.wins++; else if (ours < theirs) r.losses++; else r.ties++;
  }
  return r;
}
