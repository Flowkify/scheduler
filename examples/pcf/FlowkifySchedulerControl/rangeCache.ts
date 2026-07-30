import { addDays, toDayIndex, type VisibleRange } from "@flowkify/scheduler";

interface Partition<T> {
  version: number;
  windows: VisibleRange[];
  inFlight: Map<string, VisibleRange>;
  records: Map<string, T>;
}

function sortAndMerge(ranges: readonly VisibleRange[]): VisibleRange[] {
  const sorted = ranges
    .slice()
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  const merged: VisibleRange[] = [];
  for (const range of sorted) {
    const previous = merged[merged.length - 1];
    if (
      previous &&
      toDayIndex(range.startDate) <= toDayIndex(previous.endDate) + 1
    ) {
      if (range.endDate > previous.endDate) previous.endDate = range.endDate;
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

export function subtractIntervals(
  requested: VisibleRange,
  covered: readonly VisibleRange[]
): VisibleRange[] {
  const missing: VisibleRange[] = [];
  let cursor = requested.startDate;
  for (const range of sortAndMerge(covered)) {
    if (range.endDate < cursor) continue;
    if (range.startDate > requested.endDate) break;
    if (range.startDate > cursor) {
      missing.push({
        startDate: cursor,
        endDate: addDays(range.startDate, -1)
      });
    }
    if (range.endDate >= cursor) cursor = addDays(range.endDate, 1);
    if (cursor > requested.endDate) break;
  }
  if (cursor <= requested.endDate) {
    missing.push({ startDate: cursor, endDate: requested.endDate });
  }
  return missing;
}

export class RangeCache<T> {
  private readonly partitions = new Map<string, Partition<T>>();
  private sequence = 0;

  public constructor(private readonly getId: (record: T) => string) {}

  public async load(
    key: string,
    requested: VisibleRange,
    fetchRange: (range: VisibleRange) => Promise<readonly T[]>
  ): Promise<T[]> {
    const partition = this.partition(key);
    const covered = [
      ...partition.windows,
      ...Array.from(partition.inFlight.values())
    ];
    const missing = subtractIntervals(requested, covered);
    const generation = partition.version;
    await Promise.all(
      missing.map(async (range) => {
        const token = `${++this.sequence}:${range.startDate}:${range.endDate}`;
        partition.inFlight.set(token, range);
        try {
          const records = await fetchRange(range);
          if (partition.version !== generation) return;
          for (const record of records)
            partition.records.set(this.getId(record), record);
          partition.windows = sortAndMerge([...partition.windows, range]);
        } finally {
          partition.inFlight.delete(token);
        }
      })
    );
    return Array.from(partition.records.values());
  }

  public upsert(key: string, records: readonly T[]): void {
    const partition = this.partition(key);
    for (const record of records)
      partition.records.set(this.getId(record), record);
  }

  public patch(id: string, update: (record: T) => T): void {
    for (const partition of this.partitions.values()) {
      const record = partition.records.get(id);
      if (record) partition.records.set(id, update(record));
    }
  }

  public remove(ids: readonly string[]): void {
    for (const partition of this.partitions.values())
      for (const id of ids) partition.records.delete(id);
  }

  public invalidate(key?: string): void {
    if (key) {
      const partition = this.partitions.get(key);
      if (partition) {
        partition.version += 1;
        partition.windows = [];
        partition.records.clear();
      }
      return;
    }
    for (const partition of this.partitions.values()) {
      partition.version += 1;
      partition.windows = [];
      partition.records.clear();
    }
  }

  private partition(key: string): Partition<T> {
    const current = this.partitions.get(key);
    if (current) return current;
    const created: Partition<T> = {
      version: 0,
      windows: [],
      inFlight: new Map(),
      records: new Map()
    };
    this.partitions.set(key, created);
    return created;
  }
}

