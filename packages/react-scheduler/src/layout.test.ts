import { describe, expect, it } from "vitest";
import {
  buildCapacityMap,
  entryGeometry,
  packEntries
} from "./layout";
import type { SchedulerEntry } from "./types";

const range = { startDate: "2026-08-03", endDate: "2026-08-09" };
const entry = (
  id: string,
  startDate: string,
  endDate: string
): SchedulerEntry => ({
  id,
  personId: "p1",
  projectId: "project",
  kind: "allocation",
  startDate,
  endDate,
  hoursPerDay: 4
});

describe("scheduler layout", () => {
  it("packs two lanes and sends further collisions to overflow", () => {
    const packed = packEntries(
      [
        entry("a", "2026-08-03", "2026-08-05"),
        entry("b", "2026-08-04", "2026-08-06"),
        entry("c", "2026-08-05", "2026-08-07")
      ],
      range
    );
    expect(packed.visible.map((item) => item.lane)).toEqual([0, 1]);
    expect(packed.overflow.map((item) => item.id)).toEqual(["c"]);
  });

  it("clips spanning entries to the viewport", () => {
    expect(
      entryGeometry(entry("a", "2026-08-01", "2026-08-04"), range, 40)
    ).toEqual({ left: 0, width: 80 });
  });

  it("reports under, full, and over capacity", () => {
    const capacity = [
      { personId: "p1", date: "2026-08-03", hours: 8 },
      { personId: "p1", date: "2026-08-04", hours: 4 }
    ];
    const map = buildCapacityMap(capacity, [
      entry("a", "2026-08-03", "2026-08-04"),
      entry("b", "2026-08-04", "2026-08-04")
    ]);
    expect(map.get("p1:2026-08-03")?.status).toBe("under");
    expect(map.get("p1:2026-08-04")?.status).toBe("over");
  });
});

