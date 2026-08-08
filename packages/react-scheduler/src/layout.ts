import { eachDay, intersects, toDayIndex } from "./date";
import type {
  CapacityStatus,
  DailyCapacity,
  DateKey,
  PeriodCapacitySummary,
  SchedulerEntry,
  VisibleRange
} from "./types";

export interface PackedEntry<TMeta = unknown> {
  entry: SchedulerEntry<TMeta>;
  lane: number;
}

export interface PackedEntries<TMeta = unknown> {
  visible: PackedEntry<TMeta>[];
  overflow: SchedulerEntry<TMeta>[];
  laneCount: number;
}

export function packEntries<TMeta>(
  entries: readonly SchedulerEntry<TMeta>[],
  range: VisibleRange,
  maxLanes = 3
): PackedEntries<TMeta> {
  const laneEnds: number[] = [];
  const visible: PackedEntry<TMeta>[] = [];
  const overflow: SchedulerEntry<TMeta>[] = [];
  const sorted = entries
    .filter((entry) => intersects(entry.startDate, entry.endDate, range))
    .slice()
    .sort(
      (a, b) =>
        a.startDate.localeCompare(b.startDate) ||
        b.endDate.localeCompare(a.endDate) ||
        a.id.localeCompare(b.id)
    );

  for (const entry of sorted) {
    const start = toDayIndex(entry.startDate);
    const end = toDayIndex(entry.endDate);
    let lane = laneEnds.findIndex((laneEnd) => laneEnd < start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(end);
    } else {
      laneEnds[lane] = end;
    }
    if (lane < maxLanes) {
      visible.push({ entry, lane });
    } else {
      overflow.push(entry);
    }
  }
  return { visible, overflow, laneCount: laneEnds.length };
}

export interface CapacityState {
  available: number;
  allocated: number;
  ratio: number;
  status: CapacityStatus;
}

function capacityStatus(available: number, allocated: number): CapacityStatus {
  if (available <= 0 && allocated <= 0) return "unavailable";
  if (available <= 0 || allocated / available > 1.001) return "over";
  if (allocated / available < 0.999) return "under";
  return "full";
}

export function buildCapacityMap(
  capacity: readonly DailyCapacity[],
  entries: readonly SchedulerEntry[]
): Map<string, CapacityState> {
  const result = new Map<string, CapacityState>();
  if (!capacity.length) return result;
  for (const item of capacity) {
    result.set(`${item.personId}:${item.date}`, {
      available: Math.max(0, item.hours),
      allocated: 0,
      ratio: 0,
      status: item.hours <= 0 ? "unavailable" : "under"
    });
  }
  for (const entry of entries) {
    if (entry.kind === "absence") continue;
    for (const date of eachDay(entry)) {
      const key = `${entry.personId}:${date}`;
      const state = result.get(key) ?? {
        available: 0,
        allocated: 0,
        ratio: 0,
        status: "unavailable" as const
      };
      state.allocated += entry.hoursPerDay;
      result.set(key, state);
    }
  }
  for (const state of result.values()) {
    state.ratio =
      state.available === 0
        ? state.allocated > 0
          ? Number.POSITIVE_INFINITY
          : 0
        : state.allocated / state.available;
    state.status = capacityStatus(state.available, state.allocated);
  }
  return result;
}

export function buildPeriodCapacityMap(
  capacity: readonly DailyCapacity[],
  entries: readonly SchedulerEntry[],
  range: VisibleRange,
  personIds: readonly string[] = []
): Map<string, PeriodCapacitySummary> {
  const result = new Map<string, PeriodCapacitySummary>();
  if (!capacity.length) return result;
  for (const personId of personIds) {
    result.set(personId, {
      available: 0,
      allocated: 0,
      ratio: 0,
      status: "unavailable"
    });
  }
  const daily = buildCapacityMap(capacity, entries);
  for (const date of eachDay(range)) {
    const suffix = `:${date}`;
    for (const [key, state] of daily) {
      if (!key.endsWith(suffix)) continue;
      const personId = key.slice(0, -suffix.length);
      const summary = result.get(personId) ?? {
        available: 0,
        allocated: 0,
        ratio: 0,
        status: "unavailable" as const
      };
      summary.available += state.available;
      summary.allocated += state.allocated;
      result.set(personId, summary);
    }
  }
  for (const summary of result.values()) {
    summary.ratio =
      summary.available === 0
        ? summary.allocated > 0
          ? Number.POSITIVE_INFINITY
          : 0
        : summary.allocated / summary.available;
    summary.status = capacityStatus(summary.available, summary.allocated);
  }
  return result;
}

export function entryGeometry(
  entry: SchedulerEntry,
  range: VisibleRange,
  dayWidth: number
): { left: number; width: number } {
  const start = Math.max(toDayIndex(entry.startDate), toDayIndex(range.startDate));
  const end = Math.min(toDayIndex(entry.endDate), toDayIndex(range.endDate));
  return {
    left: (start - toDayIndex(range.startDate)) * dayWidth,
    width: Math.max(dayWidth, (end - start + 1) * dayWidth)
  };
}

export function overflowGeometry(
  entries: readonly SchedulerEntry[],
  range: VisibleRange,
  dayWidth: number
): { left: number; width: number } | undefined {
  if (!entries.length) return undefined;
  const starts = entries.map((entry) =>
    Math.max(toDayIndex(entry.startDate), toDayIndex(range.startDate))
  );
  const ends = entries.map((entry) =>
    Math.min(toDayIndex(entry.endDate), toDayIndex(range.endDate))
  );
  const start = Math.min(...starts);
  const end = Math.max(...ends);
  return {
    left: (start - toDayIndex(range.startDate)) * dayWidth,
    width: Math.max(dayWidth, (end - start + 1) * dayWidth)
  };
}

export function filterPeopleAndEntries<TEntryMeta>(
  personIds: readonly string[],
  projectIds: readonly string[],
  query: string,
  people: readonly {
    id: string;
    name: string;
    displayName?: string;
    secondaryText?: string;
  }[],
  entries: readonly SchedulerEntry<TEntryMeta>[]
): {
  personIdSet: Set<string>;
  entries: SchedulerEntry<TEntryMeta>[];
} {
  const selectedPeople = new Set(personIds);
  const selectedProjects = new Set(projectIds);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const personIdSet = new Set(
    people
      .filter(
        (person) =>
          (!selectedPeople.size || selectedPeople.has(person.id)) &&
          (!normalizedQuery ||
            `${person.name} ${person.displayName ?? ""} ${person.secondaryText ?? ""}`
              .toLocaleLowerCase()
              .includes(normalizedQuery))
      )
      .map((person) => person.id)
  );
  const visibleEntries = entries.filter(
    (entry) =>
      personIdSet.has(entry.personId) &&
      (!selectedProjects.size ||
        (entry.projectId ? selectedProjects.has(entry.projectId) : false))
  );
  if (selectedProjects.size) {
    const assignedPeople = new Set(
      visibleEntries.map((entry) => entry.personId)
    );
    for (const personId of personIdSet)
      if (!assignedPeople.has(personId) && !selectedPeople.has(personId))
        personIdSet.delete(personId);
  }
  return { personIdSet, entries: visibleEntries };
}

export function capacityKey(personId: string, date: DateKey): string {
  return `${personId}:${date}`;
}
