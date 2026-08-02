import type { SchedulerZoom } from "@flowkify/scheduler";

export function parseDefaultView(
  value: string | number | null
): SchedulerZoom {
  if (String(value) === "0") return "day";
  if (String(value) === "2") return "month";
  return "week";
}
