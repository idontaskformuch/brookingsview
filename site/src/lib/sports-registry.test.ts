import { describe, expect, it } from "vitest";
import { SPORTS, SPORT_LEVELS, sportById, sportLabel } from "./sports-registry.generated";

describe("sports registry mirror", () => {
  it("knows the result type of each sport", () => {
    expect(sportById("soccer").result_type).toBe("score");
    expect(sportById("track").result_type).toBe("placing");
    expect(sportById("speedway").result_type).toBe("time");
    expect(sportById("equestrian").result_type).toBe("none");
  });
  it("uses UK labels for gb", () => {
    expect(sportLabel("soccer", "us")).toBe("Soccer");
    expect(sportLabel("soccer", "gb")).toBe("Football");
  });
  it("fails loudly on an unknown sport id", () => {
    expect(() => sportById("quidditch")).toThrow(/unknown sport id/);
  });
  it("has unique ids and the seven levels", () => {
    expect(new Set(SPORTS.map((s) => s.id)).size).toBe(SPORTS.length);
    expect(SPORT_LEVELS).toHaveLength(7);
  });
});
