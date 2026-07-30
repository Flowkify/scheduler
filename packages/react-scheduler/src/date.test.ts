import { describe, expect, it } from "vitest";
import {
  addDays,
  daysBetween,
  eachDay,
  getVisibleRange,
  startOfWeek,
  toDayIndex
} from "./date";

describe("date-only arithmetic", () => {
  it("crosses DST boundaries without changing duration", () => {
    expect(addDays("2026-03-29", 1)).toBe("2026-03-30");
    expect(addDays("2026-10-25", 1)).toBe("2026-10-26");
    expect(daysBetween("2026-03-28", "2026-03-30")).toBe(2);
  });

  it("uses inclusive ranges", () => {
    expect(
      eachDay({ startDate: "2026-07-30", endDate: "2026-08-01" })
    ).toEqual(["2026-07-30", "2026-07-31", "2026-08-01"]);
  });

  it("builds stable day, week, and month ranges", () => {
    expect(
      getVisibleRange({ zoom: "day", anchorDate: "2026-07-30" })
    ).toEqual({ startDate: "2026-07-30", endDate: "2026-07-30" });
    expect(startOfWeek("2026-07-30", 1)).toBe("2026-07-27");
    expect(
      getVisibleRange({ zoom: "month", anchorDate: "2028-02-15" })
    ).toEqual({ startDate: "2028-02-01", endDate: "2028-02-29" });
  });

  it("rejects invalid dates", () => {
    expect(() => toDayIndex("2026-02-30")).toThrow("Invalid calendar date");
    expect(() => toDayIndex("30/07/2026")).toThrow("Invalid date key");
  });
});

