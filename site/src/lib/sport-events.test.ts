import { describe, expect, it } from "vitest";
import { countsInRecord, localDayEnd, recordFor, sportPhase, type SportEventLike } from "./sport-events";

const ev = (o: Partial<SportEventLike>): SportEventLike => ({
  sport: "football", startAt: new Date("2026-11-08T01:00:00Z"), tz: "America/Chicago", status: "scheduled", timeTba: false, exhibition: false,
  scoreHome: null, scoreAway: null, homeProgramId: "sdsu", awayProgramId: null, ...o,
});
const at = (iso: string) => new Date(iso);

describe("sportPhase", () => {
  const game = ev({ startAt: at("2026-11-07T19:00:00Z") }); // 13:00 CST Sat
  it("is upcoming before and during the game window", () => {
    expect(sportPhase(game, at("2026-11-07T15:00:00Z"))).toBe("upcoming");
    expect(sportPhase(game, at("2026-11-07T22:00:00Z"))).toBe("upcoming");
  });
  it("is 'Result pending' after the window until the local day ends, then history", () => {
    expect(sportPhase(game, at("2026-11-07T23:30:00Z"))).toBe("pending");
    expect(sportPhase(game, at("2026-11-08T05:59:00Z"))).toBe("pending"); // 23:59 CST
    expect(sportPhase(game, at("2026-11-08T06:01:00Z"))).toBe("history"); // 00:01 CST next day
  });
  it("the window is per sport: basketball (2.5 h) is pending where football (3.5 h) is still upcoming", () => {
    const start = at("2026-11-07T19:00:00Z"), now = at("2026-11-07T22:45:00Z"); // 3 h 45 after the start
    expect(sportPhase(ev({ sport: "football", startAt: start }), at("2026-11-07T22:00:00Z"))).toBe("upcoming");
    expect(sportPhase(ev({ sport: "football", startAt: start }), now)).toBe("pending");
    expect(sportPhase(ev({ sport: "basketball", startAt: start }), at("2026-11-07T21:45:00Z"))).toBe("pending");
    expect(sportPhase(ev({ sport: "golf", startAt: start }), at("2026-11-07T22:45:00Z"))).toBe("upcoming"); // golf: default 4 h, ends 23:00Z
    expect(sportPhase(ev({ sport: "golf", startAt: start }), at("2026-11-07T23:10:00Z"))).toBe("pending");
  });
  it("a time_tba game stays upcoming through its local day and is history after", () => {
    const tba = ev({ startAt: at("2026-11-28T06:00:00Z"), timeTba: true });
    expect(sportPhase(tba, at("2026-11-29T05:00:00Z"))).toBe("upcoming");
    expect(sportPhase(tba, at("2026-11-29T06:30:00Z"))).toBe("history");
  });
  it("a scheduled row from long ago is never upcoming; final/postponed/cancelled are history", () => {
    expect(sportPhase(ev({ startAt: at("2026-01-16T20:00:00Z") }), at("2026-11-08T12:00:00Z"))).toBe("history");
    for (const status of ["final", "postponed", "cancelled"] as const) expect(sportPhase(ev({ status, startAt: at("2027-01-01T00:00:00Z") }), at("2026-11-08T12:00:00Z"))).toBe("history");
  });
  it("local day end follows DST", () => {
    expect(localDayEnd(at("2026-11-01T12:00:00Z"), "America/Chicago").toISOString()).toBe("2026-11-02T06:00:00.000Z"); // fall back day
    expect(localDayEnd(at("2026-03-08T12:00:00Z"), "America/Chicago").toISOString()).toBe("2026-03-09T05:00:00.000Z"); // spring forward day
  });
});

describe("record", () => {
  // womens-basketball, 28 Oct 2026: St. Cloud State (Exhibition), W 91-62, as the adapter writes it
  const stCloud = ev({ status: "final", exhibition: true, scoreHome: 91, scoreAway: 62, awayProgramId: null });
  it("an exhibition keeps its score but is not counted", () => {
    expect(stCloud.scoreHome).toBe(91);
    expect(countsInRecord(stCloud)).toBe(false);
    expect(recordFor([stCloud], "sdsu")).toEqual({ wins: 0, losses: 0, ties: 0 });
  });
  it("counts final non-exhibitions, home and away, and ignores scheduled", () => {
    const win = ev({ status: "final", scoreHome: 70, scoreAway: 7 });
    const awayLoss = ev({ status: "final", homeProgramId: null, awayProgramId: "sdsu", scoreHome: 80, scoreAway: 60 });
    const tie = ev({ status: "final", scoreHome: 1, scoreAway: 1 });
    expect(recordFor([win, awayLoss, tie, stCloud, ev({})], "sdsu")).toEqual({ wins: 1, losses: 1, ties: 1 });
  });
});
