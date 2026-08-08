import type { SchedulerZoom } from "@flowkify/scheduler";

const DATAVERSE_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function resolveHeight(
  configured: number | null,
  allocated: number
): number | "100%" {
  return configured && configured > 0
    ? configured
    : allocated > 0
      ? allocated
      : "100%";
}

export function normalizeDataverseId(
  value: string | null | undefined
): string | undefined {
  const normalized = value?.trim().replace(/[{}]/g, "").toLowerCase();
  return normalized && DATAVERSE_ID.test(normalized) ? normalized : undefined;
}

export function parseDefaultView(
  value: string | number | null
): SchedulerZoom {
  if (String(value) === "0") return "day";
  if (String(value) === "2") return "month";
  return "week";
}
