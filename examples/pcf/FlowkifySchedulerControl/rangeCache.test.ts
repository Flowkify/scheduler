import { describe, expect, it, vi } from "vitest";
import { RangeCache, subtractIntervals } from "./rangeCache";

describe("Dataverse range cache", () => {
  it("subtracts cached windows and leaves only gaps", () => {
    expect(
      subtractIntervals(
        { startDate: "2026-08-01", endDate: "2026-08-31" },
        [
          { startDate: "2026-08-01", endDate: "2026-08-07" },
          { startDate: "2026-08-15", endDate: "2026-08-20" }
        ]
      )
    ).toEqual([
      { startDate: "2026-08-08", endDate: "2026-08-14" },
      { startDate: "2026-08-21", endDate: "2026-08-31" }
    ]);
  });

  it("fetches only a newly requested delta", async () => {
    const fetchRange = vi.fn(async (range) => [
      { id: `${range.startDate}:${range.endDate}` }
    ]);
    const cache = new RangeCache<{ id: string }>((record) => record.id);
    await cache.load(
      "all",
      { startDate: "2026-08-01", endDate: "2026-08-07" },
      fetchRange
    );
    await cache.load(
      "all",
      { startDate: "2026-08-05", endDate: "2026-08-12" },
      fetchRange
    );
    expect(fetchRange).toHaveBeenLastCalledWith({
      startDate: "2026-08-08",
      endDate: "2026-08-12"
    });
    expect(fetchRange).toHaveBeenCalledTimes(2);
  });
});

