import { describe, expect, it } from "vitest";
import {
  buildCapacityMap,
  buildPeriodCapacityMap,
  entryGeometry,
  filterPeopleAndEntries,
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
  it("packs three lanes and sends further collisions to overflow", () => {
    const packed = packEntries(
      [
        entry("a", "2026-08-03", "2026-08-05"),
        entry("b", "2026-08-04", "2026-08-06"),
        entry("c", "2026-08-05", "2026-08-07"),
        entry("d", "2026-08-05", "2026-08-05")
      ],
      range
    );
    expect(packed.visible.map((item) => item.lane)).toEqual([0, 1, 2]);
    expect(packed.overflow.map((item) => item.id)).toEqual(["d"]);
    expect(packed.laneCount).toBe(4);
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

  it("aggregates period capacity and treats scheduled zero-capacity time as over", () => {
    const summaries = buildPeriodCapacityMap(
      [
        { personId: "p1", date: "2026-08-03", hours: 8 },
        { personId: "p1", date: "2026-08-04", hours: 4 },
        { personId: "p2", date: "2026-08-03", hours: 0 }
      ],
      [
        entry("a", "2026-08-03", "2026-08-04"),
        { ...entry("b", "2026-08-03", "2026-08-03"), personId: "p2" }
      ],
      range,
      ["p1", "p2", "p3"]
    );
    expect(summaries.get("p1")).toMatchObject({
      available: 12,
      allocated: 8,
      status: "under"
    });
    expect(summaries.get("p2")?.status).toBe("over");
    expect(summaries.get("p2")?.ratio).toBe(Number.POSITIVE_INFINITY);
    expect(summaries.get("p3")?.status).toBe("unavailable");
  });

  it("keeps total capacity independent from project filtering", () => {
    const allEntries = [
      entry("atlas", "2026-08-03", "2026-08-03"),
      { ...entry("other", "2026-08-03", "2026-08-03"), projectId: "other" }
    ];
    const filtered = filterPeopleAndEntries(
      [],
      ["project"],
      "",
      [{ id: "p1", name: "Ada Lovelace", displayName: "Ada" }],
      allEntries
    );
    expect(filtered.entries.map((candidate) => candidate.id)).toEqual(["atlas"]);
    const summary = buildPeriodCapacityMap(
      [{ personId: "p1", date: "2026-08-03", hours: 8 }],
      allEntries,
      range,
      ["p1"]
    ).get("p1");
    expect(summary).toMatchObject({ allocated: 8, available: 8, status: "full" });
  });

  it("keeps explicitly selected people without project allocations visible", () => {
    const filtered = filterPeopleAndEntries(
      ["p1", "p2"],
      ["project"],
      "",
      [
        { id: "p1", name: "Ada" },
        { id: "p2", name: "Grace" }
      ],
      [entry("atlas", "2026-08-03", "2026-08-03")]
    );

    expect([...filtered.personIdSet]).toEqual(["p1", "p2"]);
    expect(filtered.entries.map((candidate) => candidate.id)).toEqual(["atlas"]);
  });
});

