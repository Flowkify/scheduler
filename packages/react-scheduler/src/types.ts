import type { CSSProperties, ReactNode } from "react";

export type DateKey = string;
export type SchedulerZoom = "day" | "week" | "month";
export type EntryVariant = "solid" | "striped" | "outline";
export type CapacityStatus = "under" | "full" | "over" | "unavailable";
export type SchedulerPeopleSort =
  | "name-asc"
  | "capacity-asc"
  | "capacity-desc";

export interface SchedulerPerson<TMeta = unknown> {
  id: string;
  name: string;
  displayName?: string;
  secondaryText?: string;
  avatarUrl?: string;
  metadata?: TMeta;
}

export interface SchedulerProject<TMeta = unknown> {
  id: string;
  name: string;
  customerName?: string;
  accentColor?: string;
  metadata?: TMeta;
}

export interface SchedulerEntry<TMeta = unknown> {
  id: string;
  personId: string;
  projectId?: string;
  kind: "allocation" | "absence" | string;
  startDate: DateKey;
  endDate: DateKey;
  hoursPerDay: number;
  title?: string;
  customerName?: string;
  details?: string;
  readOnly?: boolean;
  appearance?: {
    variant?: EntryVariant;
    accentColor?: string;
  };
  metadata?: TMeta;
}

export interface DailyCapacity {
  personId: string;
  date: DateKey;
  hours: number;
}

export interface SchedulerViewport {
  zoom: SchedulerZoom;
  anchorDate: DateKey;
}

export interface SchedulerFilters {
  query: string;
  personIds: readonly string[];
  projectIds: readonly string[];
  capacityStatuses?: readonly CapacityStatus[];
  peopleSort?: SchedulerPeopleSort;
}

export interface VisibleRange {
  startDate: DateKey;
  endDate: DateKey;
}

export interface MutationDecision {
  accepted: boolean;
  reason?: string;
  silent?: boolean;
}

export interface PeriodCapacitySummary {
  available: number;
  allocated: number;
  ratio: number;
  status: CapacityStatus;
}

export interface EntryMutation<TMeta = unknown> {
  entry: SchedulerEntry<TMeta>;
  previous: SchedulerEntry<TMeta>;
  proposed: SchedulerEntry<TMeta>;
}

export interface ResizeMutation<TMeta = unknown> extends EntryMutation<TMeta> {
  edge: "start" | "end";
}

export interface CreateDraft {
  personId: string;
  startDate: DateKey;
  endDate: DateKey;
}

export interface EntryRenderContext<TEntryMeta = unknown, TProjectMeta = unknown> {
  entry: SchedulerEntry<TEntryMeta>;
  project?: SchedulerProject<TProjectMeta> | undefined;
  pending: boolean;
  compact: boolean;
}

export interface HoverCardContext<
  TEntryMeta = unknown,
  TPersonMeta = unknown,
  TProjectMeta = unknown
> {
  entry: SchedulerEntry<TEntryMeta>;
  person?: SchedulerPerson<TPersonMeta> | undefined;
  project?: SchedulerProject<TProjectMeta> | undefined;
  dismiss: () => void;
}

export interface SchedulerProps<
  TPersonMeta = unknown,
  TProjectMeta = unknown,
  TEntryMeta = unknown
> {
  people: readonly SchedulerPerson<TPersonMeta>[];
  projects: readonly SchedulerProject<TProjectMeta>[];
  entries: readonly SchedulerEntry<TEntryMeta>[];
  capacity?: readonly DailyCapacity[];
  viewport: SchedulerViewport;
  filters: SchedulerFilters;
  onViewportChange: (viewport: SchedulerViewport) => void;
  onFiltersChange: (filters: SchedulerFilters) => void;
  onVisibleRangeChange?: (range: VisibleRange) => void;
  onCreateRequest?: (draft: CreateDraft) => Promise<MutationDecision>;
  onMoveRequest?: (mutation: EntryMutation<TEntryMeta>) => Promise<MutationDecision>;
  onResizeRequest?: (
    mutation: ResizeMutation<TEntryMeta>
  ) => Promise<MutationDecision>;
  onDeleteRequest?: (
    entry: SchedulerEntry<TEntryMeta>
  ) => Promise<MutationDecision>;
  onEntryOpen?: (entry: SchedulerEntry<TEntryMeta>) => void;
  renderEntryContent?: (
    context: EntryRenderContext<TEntryMeta, TProjectMeta>
  ) => ReactNode;
  renderHoverCard?: (
    context: HoverCardContext<TEntryMeta, TPersonMeta, TProjectMeta>
  ) => ReactNode;
  renderPersonCell?: (person: SchedulerPerson<TPersonMeta>) => ReactNode;
  locale?: string;
  weekStartsOn?: 0 | 1;
  density?: "compact" | "comfortable";
  personColumnWidth?: number;
  collapsedLaneCount?: number;
  showWeekends?: boolean;
  onShowWeekendsChange?: (showWeekends: boolean) => void;
  status?: "ready" | "loading" | "error";
  errorMessage?: string;
  className?: string;
  style?: CSSProperties;
  ariaLabel?: string;
}
