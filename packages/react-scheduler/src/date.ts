import type { DateKey, SchedulerViewport, VisibleRange } from "./types";

const DAY_MS = 86_400_000;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function toDayIndex(date: DateKey): number {
  const match = DATE_PATTERN.exec(date);
  if (!match) throw new Error(`Invalid date key: ${date}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const value = Date.UTC(year, month - 1, day);
  const parsed = new Date(value);
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error(`Invalid calendar date: ${date}`);
  }
  return Math.floor(value / DAY_MS);
}

export function fromDayIndex(day: number): DateKey {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

export function addDays(date: DateKey, amount: number): DateKey {
  return fromDayIndex(toDayIndex(date) + amount);
}

export function daysBetween(startDate: DateKey, endDate: DateKey): number {
  return toDayIndex(endDate) - toDayIndex(startDate);
}

export function eachDay(range: VisibleRange): DateKey[] {
  const first = toDayIndex(range.startDate);
  const last = toDayIndex(range.endDate);
  if (last < first) return [];
  return Array.from({ length: last - first + 1 }, (_, index) =>
    fromDayIndex(first + index)
  );
}

export function startOfWeek(date: DateKey, weekStartsOn: 0 | 1): DateKey {
  const day = toDayIndex(date);
  const weekday = new Date(day * DAY_MS).getUTCDay();
  const offset = (weekday - weekStartsOn + 7) % 7;
  return fromDayIndex(day - offset);
}

export function getVisibleRange(
  viewport: SchedulerViewport,
  weekStartsOn: 0 | 1 = 1
): VisibleRange {
  if (viewport.zoom === "day") {
    return {
      startDate: viewport.anchorDate,
      endDate: viewport.anchorDate
    };
  }
  if (viewport.zoom === "week") {
    const startDate = startOfWeek(viewport.anchorDate, weekStartsOn);
    return { startDate, endDate: addDays(startDate, 6) };
  }
  const [yearText, monthText] = viewport.anchorDate.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const startDate = `${year.toString().padStart(4, "0")}-${month
    .toString()
    .padStart(2, "0")}-01`;
  const nextMonth = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
  return { startDate, endDate: addDays(nextMonth, -1) };
}

export function navigateViewport(
  viewport: SchedulerViewport,
  direction: -1 | 1
): SchedulerViewport {
  if (viewport.zoom === "day") {
    return { ...viewport, anchorDate: addDays(viewport.anchorDate, direction) };
  }
  if (viewport.zoom === "week") {
    return { ...viewport, anchorDate: addDays(viewport.anchorDate, direction * 7) };
  }
  const [yearText, monthText] = viewport.anchorDate.split("-");
  const date = new Date(Date.UTC(Number(yearText), Number(monthText) - 1 + direction, 1));
  return { ...viewport, anchorDate: date.toISOString().slice(0, 10) };
}

export function todayKey(now = new Date()): DateKey {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function isWeekend(date: DateKey): boolean {
  const weekday = new Date(toDayIndex(date) * DAY_MS).getUTCDay();
  return weekday === 0 || weekday === 6;
}

export function intersects(
  startDate: DateKey,
  endDate: DateKey,
  range: VisibleRange
): boolean {
  return startDate <= range.endDate && endDate >= range.startDate;
}

export function clampRange(
  startDate: DateKey,
  endDate: DateKey,
  range: VisibleRange
): VisibleRange {
  return {
    startDate: startDate < range.startDate ? range.startDate : startDate,
    endDate: endDate > range.endDate ? range.endDate : endDate
  };
}

export function formatDay(
  date: DateKey,
  locale: string,
  options: Intl.DateTimeFormatOptions
): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    ...options
  }).format(new Date(toDayIndex(date) * DAY_MS));
}

