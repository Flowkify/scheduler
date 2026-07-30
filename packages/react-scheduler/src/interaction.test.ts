import { describe, expect, it } from "vitest";
import { interactionReducer } from "./interaction";
import type { SchedulerEntry } from "./types";

const allocation: SchedulerEntry<{ seriesId: string }> = {
  id: "a",
  personId: "p1",
  projectId: "project",
  kind: "allocation",
  startDate: "2026-08-03",
  endDate: "2026-08-05",
  hoursPerDay: 8,
  metadata: { seriesId: "series-1" }
};

describe("interaction reducer", () => {
  it("moves dates and person while preserving opaque metadata", () => {
    const started = interactionReducer(null, {
      type: "start-entry",
      mode: "move",
      entry: allocation,
      originDate: "2026-08-03"
    });
    const moved = interactionReducer(started, {
      type: "update",
      currentDate: "2026-08-05",
      targetPersonId: "p2"
    });
    expect(moved?.proposedEntry).toMatchObject({
      personId: "p2",
      startDate: "2026-08-05",
      endDate: "2026-08-07",
      metadata: { seriesId: "series-1" }
    });
  });

  it("never resizes past a one-day entry", () => {
    const started = interactionReducer(null, {
      type: "start-entry",
      mode: "resize-start",
      entry: allocation,
      originDate: allocation.startDate
    });
    const resized = interactionReducer(started, {
      type: "update",
      currentDate: "2026-08-12",
      targetPersonId: "p1"
    });
    expect(resized?.proposedEntry?.startDate).toBe(allocation.endDate);
  });

  it("creates an inclusive range in either direction", () => {
    const started = interactionReducer(null, {
      type: "start-create",
      personId: "p1",
      originDate: "2026-08-07"
    });
    const created = interactionReducer(started, {
      type: "update",
      currentDate: "2026-08-03",
      targetPersonId: "p2"
    });
    expect(created?.createDraft).toEqual({
      personId: "p2",
      startDate: "2026-08-03",
      endDate: "2026-08-07"
    });
  });
});

