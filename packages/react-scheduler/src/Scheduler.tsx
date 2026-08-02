import * as React from "react";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  eachDay,
  formatDay,
  getVisibleRange,
  isWeekend,
  navigateViewport,
  todayKey
} from "./date";
import {
  buildCapacityMap,
  buildPeriodCapacityMap,
  capacityKey,
  entryGeometry,
  filterPeopleAndEntries,
  packEntries,
  type CapacityState
} from "./layout";
import type { InteractionState } from "./interaction";
import type {
  CapacityStatus,
  CreateDraft,
  EntryRenderContext,
  PeriodCapacitySummary,
  SchedulerEntry,
  SchedulerFilters,
  SchedulerPerson,
  SchedulerProject,
  SchedulerProps,
  SchedulerViewport,
  VisibleRange
} from "./types";
import { OverlayPortal } from "./HoverPortal";
import { useVariableVirtualRows } from "./useFixedVirtualRows";
import { usePointerInteraction } from "./usePointerInteraction";
import "./styles.css";

const DEFAULT_PERSON_COLUMN_WIDTH = 216;
const MIN_DAY_WIDTH = { day: 240, week: 92, month: 34 } as const;
const LANE_HEIGHT = { compact: 20, comfortable: 26 } as const;
const ROW_PADDING = { compact: 8, comfortable: 10 } as const;

export function getTimelineRange(
  range: VisibleRange,
  zoom: SchedulerViewport["zoom"],
  showWeekends: boolean
): VisibleRange {
  if (zoom !== "week" || showWeekends) return range;
  const weekdays = eachDay(range).filter((date) => !isWeekend(date));
  return {
    startDate: weekdays[0] ?? range.startDate,
    endDate: weekdays[weekdays.length - 1] ?? range.endDate
  };
}

function overlayAnchor(target: HTMLElement, rect: DOMRect): DOMRect {
  let ancestor: HTMLElement | null = target.closest(".fks-root");
  while (ancestor && ancestor !== document.body) {
    const style = getComputedStyle(ancestor);
    const transformed = [style.transform, style.perspective, style.filter].some(
      (value) => value && value !== "none"
    );
    if (transformed || style.willChange.includes("transform")) {
      const bounds = ancestor.getBoundingClientRect();
      const scaleX = bounds.width / ancestor.offsetWidth || 1;
      const scaleY = bounds.height / ancestor.offsetHeight || 1;
      return new DOMRect(
        (rect.left - bounds.left) / scaleX,
        (rect.top - bounds.top) / scaleY,
        rect.width / scaleX,
        rect.height / scaleY
      );
    }
    ancestor = ancestor.parentElement;
  }
  return rect;
}

type AnySchedulerProps = SchedulerProps<unknown, unknown, unknown>;

interface HoverState {
  entry: SchedulerEntry;
  anchor: DOMRect;
}

type ContextMenuState = HoverState;

interface SchedulerNotice {
  id: number;
  tone: "success" | "error";
  message: string;
}

interface RowProps {
  person: SchedulerPerson;
  entries: SchedulerEntry[];
  projects: Map<string, SchedulerProject>;
  range: VisibleRange;
  days: string[];
  dayWidth: number;
  rowHeight: number;
  laneHeight: number;
  personColumnWidth: number;
  collapsedLaneCount: number;
  expanded: boolean;
  capacityMap: Map<string, CapacityState>;
  capacitySummary?: PeriodCapacitySummary;
  pendingIds: Set<string>;
  createDraft?: CreateDraft;
  renderEntryContent?: AnySchedulerProps["renderEntryContent"];
  renderPersonCell?: AnySchedulerProps["renderPersonCell"];
  onStartEntry: ReturnType<typeof usePointerInteraction>["startEntry"];
  onStartCreate: ReturnType<typeof usePointerInteraction>["startCreate"];
  onHover: (entry: SchedulerEntry, anchor: DOMRect) => void;
  onHoverCancel: () => void;
  onContextMenu: (entry: SchedulerEntry, anchor: DOMRect) => void;
  onOpen: (entry: SchedulerEntry) => void;
  onDelete: (entry: SchedulerEntry) => void;
  onToggleExpanded: (personId: string) => void;
}

const SchedulerRow = memo(function SchedulerRow({
  person,
  entries,
  projects,
  range,
  days,
  dayWidth,
  rowHeight,
  laneHeight,
  personColumnWidth,
  collapsedLaneCount,
  expanded,
  capacityMap,
  capacitySummary,
  pendingIds,
  createDraft,
  renderEntryContent,
  renderPersonCell,
  onStartEntry,
  onStartCreate,
  onHover,
  onHoverCancel,
  onContextMenu,
  onOpen,
  onDelete,
  onToggleExpanded
}: RowProps) {
  const packed = packEntries(
    entries,
    range,
    expanded ? Number.MAX_SAFE_INTEGER : collapsedLaneCount
  );
  const displayName = person.displayName ?? person.name;
  const capacityFill = capacitySummary
    ? Math.min(1, capacitySummary.ratio) * 100
    : 0;
  const capacityPercent = capacitySummary
    ? Number.isFinite(capacitySummary.ratio)
      ? `${Math.round(capacitySummary.ratio * 100)}%`
      : ">100%"
    : "—";
  return (
    <div
      className="fks-row"
      data-person-id={person.id}
      style={{ height: rowHeight, width: personColumnWidth + days.length * dayWidth }}
      role="row"
    >
      <div
        className="fks-person-cell"
        style={{ width: personColumnWidth }}
        role="rowheader"
      >
        {renderPersonCell ? (
          renderPersonCell(person)
        ) : (
          <>
            {person.avatarUrl ? (
              <img className="fks-avatar" src={person.avatarUrl} alt="" />
            ) : (
              <span className="fks-avatar fks-avatar--fallback" aria-hidden="true">
                {person.name
                  .split(/\s+/)
                  .slice(0, 2)
                  .map((part) => part[0])
                  .join("")}
              </span>
            )}
            <span className="fks-person-copy">
              <strong title={person.name}>{displayName}</strong>
              {person.secondaryText && <small>{person.secondaryText}</small>}
            </span>
          </>
        )}
        {(packed.overflow.length > 0 || expanded) && (
          <button
            type="button"
            className="fks-row-expander"
            aria-expanded={expanded}
            aria-label={`${expanded ? "Collapse" : "Expand"} allocations for ${person.name}`}
            onClick={() => onToggleExpanded(person.id)}
          >
            <span aria-hidden="true">{expanded ? "⌃" : "⌄"}</span>
            {!expanded && packed.overflow.length > 0 && (
              <small>+{packed.overflow.length}</small>
            )}
          </button>
        )}
        {capacitySummary && (
          <span
            className={`fks-period-capacity fks-period-capacity--${capacitySummary.status}`}
            title={`${capacitySummary.allocated}h scheduled of ${capacitySummary.available}h available (${capacityPercent})`}
            aria-label={`${capacityPercent} capacity for ${person.name}`}
          >
            <span className="fks-period-capacity__bar" aria-hidden="true">
              <span style={{ height: `${capacityFill}%` }} />
            </span>
            <small>{capacityPercent}</small>
          </span>
        )}
      </div>
      <div
        className="fks-timeline-row"
        style={{
          left: personColumnWidth,
          width: days.length * dayWidth,
          gridTemplateColumns: `repeat(${days.length}, ${dayWidth}px)`
        }}
        onPointerDown={(event) => onStartCreate(event, person.id)}
        role="gridcell"
      >
        {days.map((date) => {
          const capacity = capacityMap.get(capacityKey(person.id, date));
          const ratio = Math.min(1, capacity?.ratio ?? 0);
          return (
            <div
              key={date}
              className={`fks-day-cell${isWeekend(date) ? " fks-day-cell--weekend" : ""}${
                date === todayKey() ? " fks-day-cell--today" : ""
              }${capacity?.status === "unavailable" ? " fks-day-cell--unavailable" : ""}`}
              data-date={date}
            >
              {capacity && (
                <span
                  className={`fks-capacity fks-capacity--${capacity.status}`}
                  title={`${capacity.allocated}h scheduled of ${capacity.available}h available`}
                >
                  <span style={{ width: `${ratio * 100}%` }} />
                </span>
              )}
            </div>
          );
        })}
        {packed.visible.map(({ entry, lane }) => {
          const project = entry.projectId
            ? projects.get(entry.projectId)
            : undefined;
          const geometry = entryGeometry(entry, range, dayWidth);
          const pending = pendingIds.has(entry.id);
          const variant =
            entry.appearance?.variant ??
            (entry.kind === "absence" ? "striped" : "solid");
          const renderContext: EntryRenderContext = {
            entry,
            pending,
            compact: geometry.width < 150,
            ...(project ? { project } : {})
          };
          return (
            <div
              key={entry.id}
              className={`fks-entry fks-entry--${variant}${
                entry.kind === "absence" ? " fks-entry--absence" : ""
              }${entry.readOnly ? " fks-entry--readonly" : ""}${
                pending ? " fks-entry--pending" : ""
              }`}
              data-entry-id={entry.id}
              tabIndex={0}
              role="button"
              aria-label={`${entry.title ?? project?.name ?? "Schedule entry"}, ${entry.hoursPerDay} hours per day, ${entry.startDate} to ${entry.endDate}`}
              style={{
                left: geometry.left + 2,
                width: geometry.width - 4,
                top: 4 + lane * laneHeight,
                height: laneHeight - 4,
                "--fks-entry-accent":
                  entry.appearance?.accentColor ??
                  project?.accentColor ??
                  "var(--fks-accent)"
              } as React.CSSProperties}
              onPointerDown={(event) => onStartEntry(event, entry, "move")}
              onMouseEnter={(event) =>
                onHover(
                  entry,
                  overlayAnchor(
                    event.currentTarget,
                    new DOMRect(event.clientX, event.clientY, 0, 0)
                  )
                )
              }
              onMouseLeave={onHoverCancel}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onContextMenu(
                  entry,
                  overlayAnchor(
                    event.currentTarget,
                    event.clientX || event.clientY
                      ? new DOMRect(event.clientX, event.clientY, 0, 0)
                      : event.currentTarget.getBoundingClientRect()
                  )
                );
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") onOpen(entry);
                if (
                  (event.key === "Delete" || event.key === "Backspace") &&
                  !entry.readOnly
                )
                  onDelete(entry);
              }}
            >
              {!entry.readOnly && (
                <span
                  className="fks-resize fks-resize--start"
                  aria-hidden="true"
                  onPointerDown={(event) =>
                    onStartEntry(event, entry, "resize-start")
                  }
                />
              )}
              <span className="fks-entry-content">
                {renderEntryContent ? (
                  renderEntryContent(renderContext)
                ) : (
                  <>
                    <strong>{entry.title ?? project?.name ?? "Allocation"}</strong>
                    <span className="fks-entry-customer">
                      {entry.customerName ?? project?.customerName}
                    </span>
                    <span className="fks-entry-hours">{entry.hoursPerDay}h</span>
                  </>
                )}
              </span>
              {!entry.readOnly && (
                <span
                  className="fks-resize fks-resize--end"
                  aria-hidden="true"
                  onPointerDown={(event) =>
                    onStartEntry(event, entry, "resize-end")
                  }
                />
              )}
            </div>
          );
        })}
        {createDraft && (
          <div
            className="fks-entry fks-entry--outline fks-entry--pending fks-create-preview"
            style={{
              ...entryGeometry(
                {
                  id: "new",
                  personId: createDraft.personId,
                  kind: "allocation",
                  startDate: createDraft.startDate,
                  endDate: createDraft.endDate,
                  hoursPerDay: 0
                },
                range,
                dayWidth
              ),
              top: 4,
              height: laneHeight - 4
            }}
          >
            New allocation
          </div>
        )}
      </div>
    </div>
  );
});

export function Scheduler<
  TPersonMeta = unknown,
  TProjectMeta = unknown,
  TEntryMeta = unknown
>(
  props: SchedulerProps<TPersonMeta, TProjectMeta, TEntryMeta>
): JSX.Element {
  return <SchedulerImplementation {...(props as AnySchedulerProps)} />;
}

function SchedulerImplementation(props: AnySchedulerProps): JSX.Element {
  const {
    people,
    projects,
    entries,
    capacity = [],
    viewport,
    filters,
    onViewportChange,
    onFiltersChange,
    onVisibleRangeChange,
    locale = "en",
    weekStartsOn = 1,
    density = "compact",
    personColumnWidth = DEFAULT_PERSON_COLUMN_WIDTH,
    collapsedLaneCount = 3,
    showWeekends = false,
    onShowWeekendsChange,
    status = "ready",
    errorMessage = "The schedule could not be loaded.",
    ariaLabel = "Employee schedule"
  } = props;
  const hoverTimerRef = useRef<number>();
  const noticeIdRef = useRef(0);
  const noticeTimersRef = useRef(new Map<number, number>());
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(960);
  const [openFilter, setOpenFilter] = useState<"filters" | "view" | null>(null);
  const [filterSection, setFilterSection] = useState<
    "people" | "projects" | "capacity" | "sort"
  >("people");
  const [peopleQuery, setPeopleQuery] = useState("");
  const [projectQuery, setProjectQuery] = useState("");
  const [hover, setHover] = useState<HoverState | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [expandedPeople, setExpandedPeople] = useState<Set<string>>(new Set());
  const [notices, setNotices] = useState<SchedulerNotice[]>([]);
  const [pendingPreviews, setPendingPreviews] = useState<
    Map<string, SchedulerEntry>
  >(new Map());
  const [pendingCreate, setPendingCreate] = useState<CreateDraft | undefined>();
  const captureScrollElement = useCallback(
    (node: HTMLDivElement | null) => setScrollElement(node),
    []
  );
  const dismissNotice = useCallback((id: number) => {
    const timer = noticeTimersRef.current.get(id);
    if (timer) window.clearTimeout(timer);
    noticeTimersRef.current.delete(id);
    setNotices((current) => current.filter((notice) => notice.id !== id));
  }, []);
  const addNotice = useCallback(
    (tone: SchedulerNotice["tone"], message: string) => {
      const id = ++noticeIdRef.current;
      setNotices((current) => [...current, { id, tone, message }].slice(-3));
      if (tone === "success") {
        const timer = window.setTimeout(() => dismissNotice(id), 4_000);
        noticeTimersRef.current.set(id, timer);
      }
    },
    [dismissNotice]
  );

  const range = useMemo(
    () => getVisibleRange(viewport, weekStartsOn),
    [viewport, weekStartsOn]
  );
  const timelineRange = useMemo(
    () => getTimelineRange(range, viewport.zoom, showWeekends),
    [range, showWeekends, viewport.zoom]
  );
  const days = useMemo(() => eachDay(timelineRange), [timelineRange]);
  const safeCollapsedLaneCount = Math.max(1, Math.floor(collapsedLaneCount));
  const timelineAvailable = Math.max(320, containerWidth - personColumnWidth);
  const dayWidth = Math.max(
    MIN_DAY_WIDTH[viewport.zoom],
    timelineAvailable / Math.max(1, days.length)
  );
  const laneHeight = LANE_HEIGHT[density];
  const rowPadding = ROW_PADDING[density];
  const projectsById = useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects]
  );
  const matchingPeople = useMemo(() => {
    const query = peopleQuery.trim().toLocaleLowerCase(locale);
    return query
      ? people.filter((person) =>
          `${person.name} ${person.displayName ?? ""}`
            .toLocaleLowerCase(locale)
            .includes(query)
        )
      : people;
  }, [locale, people, peopleQuery]);
  const matchingProjects = useMemo(() => {
    const query = projectQuery.trim().toLocaleLowerCase(locale);
    return query
      ? projects.filter((project) =>
          `${project.name} ${project.customerName ?? ""}`
            .toLocaleLowerCase(locale)
            .includes(query)
        )
      : projects;
  }, [locale, projectQuery, projects]);
  const activeFilterCount =
    filters.personIds.length +
    filters.projectIds.length +
    (filters.capacityStatuses?.length ?? 0);
  const effectiveAllEntries = useMemo(() => {
    const previewIds = new Set(pendingPreviews.keys());
    return entries
      .filter((entry) => !previewIds.has(entry.id))
      .concat(Array.from(pendingPreviews.values()));
  }, [entries, pendingPreviews]);
  const filtered = useMemo(
    () =>
      filterPeopleAndEntries(
        filters.personIds,
        filters.projectIds,
        filters.query,
        people,
        effectiveAllEntries
      ),
    [effectiveAllEntries, filters, people]
  );
  const capacityMap = useMemo(
    () => buildCapacityMap(capacity, effectiveAllEntries),
    [capacity, effectiveAllEntries]
  );
  const periodCapacityMap = useMemo(
    () =>
      buildPeriodCapacityMap(
        capacity,
        effectiveAllEntries,
        range,
        people.map((person) => person.id)
      ),
    [capacity, effectiveAllEntries, people, range]
  );
  const filteredPeople = useMemo(() => {
    const statuses = new Set(filters.capacityStatuses ?? []);
    const sort = filters.peopleSort ?? "name-asc";
    const compareName = (left: SchedulerPerson, right: SchedulerPerson) =>
      (left.displayName ?? left.name).localeCompare(
        right.displayName ?? right.name,
        locale,
        { sensitivity: "base" }
      ) ||
      left.name.localeCompare(right.name, locale, { sensitivity: "base" }) ||
      left.id.localeCompare(right.id);
    return people
      .filter((person) => filtered.personIdSet.has(person.id))
      .filter((person) => {
        if (!statuses.size) return true;
        const summary = periodCapacityMap.get(person.id);
        return summary ? statuses.has(summary.status) : false;
      })
      .slice()
      .sort((left, right) => {
        if (sort === "name-asc") return compareName(left, right);
        const leftSummary = periodCapacityMap.get(left.id);
        const rightSummary = periodCapacityMap.get(right.id);
        const leftUnavailable = !leftSummary || leftSummary.status === "unavailable";
        const rightUnavailable =
          !rightSummary || rightSummary.status === "unavailable";
        if (leftUnavailable !== rightUnavailable) return leftUnavailable ? 1 : -1;
        const leftRatio = leftSummary?.ratio ?? 0;
        const rightRatio = rightSummary?.ratio ?? 0;
        const ratioOrder =
          sort === "capacity-asc"
            ? leftRatio - rightRatio
            : rightRatio - leftRatio;
        return ratioOrder || compareName(left, right);
      });
  }, [filtered.personIdSet, filters.capacityStatuses, filters.peopleSort, locale, people, periodCapacityMap]);
  const entriesByPerson = useMemo(() => {
    const map = new Map<string, SchedulerEntry[]>();
    for (const entry of filtered.entries) {
      const current = map.get(entry.personId);
      if (current) current.push(entry);
      else map.set(entry.personId, [entry]);
    }
    return map;
  }, [filtered.entries]);
  const pendingIds = useMemo(
    () => new Set(pendingPreviews.keys()),
    [pendingPreviews]
  );

  useEffect(() => {
    if (!scrollElement) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setContainerWidth(entry.contentRect.width);
    });
    observer.observe(scrollElement);
    return () => observer.disconnect();
  }, [scrollElement]);

  useEffect(() => {
    onVisibleRangeChange?.(range);
  }, [onVisibleRangeChange, range]);

  useEffect(
    () => () => {
      window.clearTimeout(hoverTimerRef.current);
      for (const timer of noticeTimersRef.current.values())
        window.clearTimeout(timer);
    },
    []
  );

  const finishInteraction = useCallback(
    async (interaction: InteractionState<unknown>) => {
      if (interaction.mode === "create" && interaction.createDraft) {
        const callback = props.onCreateRequest;
        if (!callback) return;
        setPendingCreate(interaction.createDraft);
        try {
          const decision = await callback(interaction.createDraft);
          if (!decision.silent)
            addNotice(
              decision.accepted ? "success" : "error",
              decision.accepted
                ? "Allocation created."
                : decision.reason ?? "Creation was rejected."
            );
        } catch (error) {
          addNotice(
            "error",
            error instanceof Error ? error.message : "Creation failed."
          );
        } finally {
          setPendingCreate(undefined);
        }
        return;
      }
      if (!interaction.entry || !interaction.proposedEntry) return;
      const previous = interaction.entry;
      const proposed = interaction.proposedEntry;
      const callback =
        interaction.mode === "move"
          ? props.onMoveRequest
          : props.onResizeRequest;
      if (!callback || JSON.stringify(previous) === JSON.stringify(proposed))
        return;
      setPendingPreviews((current) => new Map(current).set(previous.id, proposed));
      try {
        const decision =
          interaction.mode === "move"
            ? await props.onMoveRequest?.({ entry: previous, previous, proposed })
            : await props.onResizeRequest?.({
                entry: previous,
                previous,
                proposed,
                edge: interaction.mode === "resize-start" ? "start" : "end"
              });
        if (decision && !decision.silent)
          addNotice(
            decision.accepted ? "success" : "error",
            decision.accepted
              ? interaction.mode === "move"
                ? "Allocation moved."
                : "Allocation resized."
              : decision.reason ?? "The change was rejected."
          );
      } catch (error) {
        addNotice(
          "error",
          error instanceof Error ? error.message : "The change failed."
        );
      } finally {
        setPendingPreviews((current) => {
          const next = new Map(current);
          next.delete(previous.id);
          return next;
        });
      }
    },
    [
      addNotice,
      props.onCreateRequest,
      props.onMoveRequest,
      props.onResizeRequest
    ]
  );

  const openEntry = useCallback(
    (entry: SchedulerEntry) => {
      setHover(null);
      setContextMenu(null);
      props.onEntryOpen?.(entry);
    },
    [props.onEntryOpen]
  );

  const pointer = usePointerInteraction({
    scrollElement,
    range: timelineRange,
    dayWidth,
    personColumnWidth,
    onFinish: finishInteraction,
    onEntryClick: openEntry
  });

  const activeEntries = useMemo(() => {
    if (!pointer.state?.entry || !pointer.state.proposedEntry)
      return entriesByPerson;
    const map = new Map(entriesByPerson);
    const original = pointer.state.entry;
    const proposed = pointer.state.proposedEntry;
    map.set(
      original.personId,
      (map.get(original.personId) ?? []).filter(
        (entry) => entry.id !== original.id
      )
    );
    map.set(proposed.personId, [
      ...(map.get(proposed.personId) ?? []).filter(
        (entry) => entry.id !== proposed.id
      ),
      proposed
    ]);
    return map;
  }, [entriesByPerson, pointer.state]);

  const getPersonKey = useCallback(
    (index: number) => filteredPeople[index]?.id ?? index,
    [filteredPeople]
  );
  const rowSizes = useMemo(
    () =>
      filteredPeople.map((person) => {
        const laneCount = packEntries(
          activeEntries.get(person.id) ?? [],
          timelineRange,
          Number.MAX_SAFE_INTEGER
        ).laneCount;
        const visibleLanes = expandedPeople.has(person.id)
          ? Math.max(safeCollapsedLaneCount, laneCount)
          : safeCollapsedLaneCount;
        return rowPadding + visibleLanes * laneHeight;
      }),
    [activeEntries, expandedPeople, filteredPeople, laneHeight, rowPadding, safeCollapsedLaneCount, timelineRange]
  );
  const virtualizer = useVariableVirtualRows({
    scrollElement,
    sizes: rowSizes,
    offset: 48,
    overscan: 8,
    getKey: getPersonKey
  });

  const changeSelection = (
    key: "personIds" | "projectIds",
    id: string
  ) => {
    const current = filters[key];
    onFiltersChange({
      ...filters,
      [key]: current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id]
    });
  };

  const changeCapacityStatus = (statusValue: CapacityStatus) => {
    const current = filters.capacityStatuses ?? [];
    onFiltersChange({
      ...filters,
      capacityStatuses: current.includes(statusValue)
        ? current.filter((value) => value !== statusValue)
        : [...current, statusValue]
    });
  };

  const deleteEntry = useCallback(
    async (entry: SchedulerEntry) => {
      if (!props.onDeleteRequest || entry.readOnly) return;
      setPendingPreviews((current) => new Map(current).set(entry.id, entry));
      try {
        const decision = await props.onDeleteRequest(entry);
        if (!decision.silent)
          addNotice(
            decision.accepted ? "success" : "error",
            decision.accepted
              ? "Allocation deleted."
              : decision.reason ?? "Deletion was rejected."
          );
      } catch (error) {
        addNotice(
          "error",
          error instanceof Error ? error.message : "Deletion failed."
        );
      } finally {
        setPendingPreviews((current) => {
          const next = new Map(current);
          next.delete(entry.id);
          return next;
        });
      }
    },
    [addNotice, props.onDeleteRequest]
  );

  const showHover = useCallback((entry: SchedulerEntry, anchor: DOMRect) => {
    window.clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = window.setTimeout(
      () => setHover({ entry, anchor }),
      260
    );
  }, []);
  const cancelHover = useCallback(() => {
    window.clearTimeout(hoverTimerRef.current);
    setHover(null);
  }, []);
  const showContextMenu = useCallback(
    (entry: SchedulerEntry, anchor: DOMRect) => {
      cancelHover();
      setContextMenu({ entry, anchor });
    },
    [cancelHover]
  );
  const toggleExpanded = useCallback((personId: string) => {
    setExpandedPeople((current) => {
      const next = new Set(current);
      if (next.has(personId)) next.delete(personId);
      else next.add(personId);
      return next;
    });
  }, []);

  const rangeLabel =
    viewport.zoom === "day"
      ? formatDay(range.startDate, locale, {
          weekday: "long",
          month: "long",
          day: "numeric",
          year: "numeric"
        })
      : `${formatDay(range.startDate, locale, {
          month: "short",
          day: "numeric"
        })} – ${formatDay(range.endDate, locale, {
          month: "short",
          day: "numeric",
          year: "numeric"
        })}`;

  return (
    <section
      className={`fks-root${props.className ? ` ${props.className}` : ""}`}
      style={props.style}
      aria-label={ariaLabel}
      aria-busy={status === "loading"}
    >
      <div className="fks-toolbar">
        <div className="fks-toolbar__filters">
          <FilterButton
            label="Filters"
            icon="☷"
            count={activeFilterCount}
            open={openFilter === "filters"}
            menuClassName="fks-filter-menu--filters"
            onClick={() =>
              setOpenFilter((value) => (value === "filters" ? null : "filters"))
            }
          >
            <div className="fks-filter-tabs" role="tablist" aria-label="Filter categories">
              {(
                [
                  ["people", "People"],
                  ["projects", "Projects"],
                  ["capacity", "Capacity"],
                  ["sort", "Sort"]
                ] as const
              ).map(([section, label]) => (
                <button
                  key={section}
                  type="button"
                  role="tab"
                  aria-selected={filterSection === section}
                  onClick={() => setFilterSection(section)}
                >
                  {label}
                </button>
              ))}
            </div>
            {filterSection === "people" && (
              <>
                <MenuSearch
                  label="Search people"
                  value={peopleQuery}
                  onChange={setPeopleQuery}
                />
                <div className="fks-filter-options">
                  {matchingPeople.map((person) => (
                    <FilterOption
                      key={person.id}
                      checked={filters.personIds.includes(person.id)}
                      label={person.name}
                      onChange={() => changeSelection("personIds", person.id)}
                    />
                  ))}
                  {!matchingPeople.length && <FilterEmpty />}
                </div>
              </>
            )}
            {filterSection === "projects" && (
              <>
                <MenuSearch
                  label="Search projects or companies"
                  value={projectQuery}
                  onChange={setProjectQuery}
                />
                <div className="fks-filter-options">
                  {matchingProjects.map((project) => (
                    <FilterOption
                      key={project.id}
                      checked={filters.projectIds.includes(project.id)}
                      label={`${project.name}${project.customerName ? ` · ${project.customerName}` : ""}`}
                      onChange={() => changeSelection("projectIds", project.id)}
                    />
                  ))}
                  {!matchingProjects.length && <FilterEmpty />}
                </div>
              </>
            )}
            {filterSection === "capacity" && (
              <div className="fks-filter-options">
                {capacity.length > 0 ? (
                  (
                    [
                      ["under", "Under capacity"],
                      ["full", "At capacity"],
                      ["over", "Over capacity"],
                      ["unavailable", "Unavailable"]
                    ] as const
                  ).map(([statusValue, label]) => (
                    <FilterOption
                      key={statusValue}
                      checked={(filters.capacityStatuses ?? []).includes(statusValue)}
                      label={label}
                      onChange={() => changeCapacityStatus(statusValue)}
                    />
                  ))
                ) : (
                  <FilterEmpty label="Capacity data is unavailable." />
                )}
              </div>
            )}
            {filterSection === "sort" && (
              <div className="fks-filter-options">
                <SortOption
                  checked={(filters.peopleSort ?? "name-asc") === "name-asc"}
                  label="Name A–Z"
                  onChange={() =>
                    onFiltersChange({ ...filters, peopleSort: "name-asc" })
                  }
                />
                {capacity.length > 0 && (
                  <>
                    <SortOption
                      checked={filters.peopleSort === "capacity-asc"}
                      label="Capacity low to high"
                      onChange={() =>
                        onFiltersChange({ ...filters, peopleSort: "capacity-asc" })
                      }
                    />
                    <SortOption
                      checked={filters.peopleSort === "capacity-desc"}
                      label="Capacity high to low"
                      onChange={() =>
                        onFiltersChange({ ...filters, peopleSort: "capacity-desc" })
                      }
                    />
                  </>
                )}
              </div>
            )}
          </FilterButton>
          {viewport.zoom === "week" && onShowWeekendsChange && (
            <FilterButton
              label="View"
              icon="⚙"
              count={0}
              open={openFilter === "view"}
              onClick={() =>
                setOpenFilter((value) => (value === "view" ? null : "view"))
              }
            >
              <FilterOption
                checked={showWeekends}
                label="Show weekends"
                onChange={() => onShowWeekendsChange(!showWeekends)}
              />
              <p className="fks-filter-hint">
                Capacity totals always include the full week.
              </p>
            </FilterButton>
          )}
        </div>
        <div className="fks-navigation">
          <button
            type="button"
            onClick={() => onViewportChange(navigateViewport(viewport, -1))}
            aria-label="Previous period"
          >
            ←
          </button>
          <button
            type="button"
            className="fks-today-button"
            onClick={() =>
              onViewportChange({ ...viewport, anchorDate: todayKey() })
            }
          >
            <span className="fks-button-icon" aria-hidden="true">⌾</span>
            <span className="fks-button-label">Today</span>
          </button>
          <button
            type="button"
            onClick={() => onViewportChange(navigateViewport(viewport, 1))}
            aria-label="Next period"
          >
            →
          </button>
          <strong className="fks-range-label">{rangeLabel}</strong>
        </div>
        <div className="fks-zoom" aria-label="Schedule zoom">
          {(["day", "week", "month"] as const).map((zoom) => (
            <button
              key={zoom}
              type="button"
              aria-pressed={viewport.zoom === zoom}
              onClick={() => onViewportChange({ ...viewport, zoom })}
            >
              <span className="fks-zoom-short">{zoom[0]?.toUpperCase()}</span>
              <span className="fks-zoom-label">{zoom.slice(1)}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="fks-scroll-shell">
        <div
          ref={captureScrollElement}
          className="fks-scroll"
          role="grid"
          aria-rowcount={filteredPeople.length}
          aria-colcount={days.length}
        >
          <div
            className="fks-board"
            style={{
              width: personColumnWidth + days.length * dayWidth,
              minHeight: "100%"
            }}
          >
            <div
              className="fks-header"
              style={{ width: personColumnWidth + days.length * dayWidth }}
              role="row"
            >
              <div
                className="fks-person-header"
                style={{ width: personColumnWidth }}
              >
                <span>{filteredPeople.length} people</span>
                <small>Capacity</small>
              </div>
              <div
                className="fks-date-header"
                style={{
                  left: personColumnWidth,
                  width: days.length * dayWidth,
                  gridTemplateColumns: `repeat(${days.length}, ${dayWidth}px)`
                }}
              >
                {days.map((date) => (
                  <div
                    key={date}
                    className={`${isWeekend(date) ? "fks-date--weekend" : ""}${
                      date === todayKey() ? " fks-date--today" : ""
                    }`}
                    role="columnheader"
                  >
                    <span>
                      {formatDay(date, locale, {
                        weekday: viewport.zoom === "month" ? "narrow" : "short"
                      })}
                    </span>
                    <strong>{formatDay(date, locale, { day: "numeric" })}</strong>
                  </div>
                ))}
              </div>
            </div>
            <div
              className="fks-rows"
              style={{ height: virtualizer.totalSize }}
            >
              {virtualizer.rows.map((virtualRow) => {
                const person = filteredPeople[virtualRow.index];
                if (!person) return null;
                const activeCreate =
                  (pointer.state?.createDraft?.personId === person.id
                    ? pointer.state.createDraft
                    : undefined) ??
                  (pendingCreate?.personId === person.id ? pendingCreate : undefined);
                const capacitySummary = periodCapacityMap.get(person.id);
                return (
                  <div
                    key={person.id}
                    className="fks-virtual-row"
                    style={{
                      height: virtualRow.size,
                      transform: `translateY(${virtualRow.start}px)`
                    }}
                  >
                    <SchedulerRow
                      person={person}
                      entries={activeEntries.get(person.id) ?? []}
                      projects={projectsById}
                      range={timelineRange}
                      days={days}
                      dayWidth={dayWidth}
                      rowHeight={virtualRow.size}
                      laneHeight={laneHeight}
                      personColumnWidth={personColumnWidth}
                      collapsedLaneCount={safeCollapsedLaneCount}
                      expanded={expandedPeople.has(person.id)}
                      capacityMap={capacityMap}
                      {...(capacitySummary
                        ? { capacitySummary }
                        : {})}
                      pendingIds={pendingIds}
                      {...(activeCreate ? { createDraft: activeCreate } : {})}
                      {...(props.renderEntryContent
                        ? { renderEntryContent: props.renderEntryContent }
                        : {})}
                      {...(props.renderPersonCell
                        ? { renderPersonCell: props.renderPersonCell }
                        : {})}
                      onStartEntry={pointer.startEntry}
                      onStartCreate={pointer.startCreate}
                      onHover={showHover}
                      onHoverCancel={cancelHover}
                      onContextMenu={showContextMenu}
                      onOpen={openEntry}
                      onDelete={deleteEntry}
                      onToggleExpanded={toggleExpanded}
                    />
                  </div>
                );
              })}
            </div>
            {!filteredPeople.length && status === "ready" && (
              <div className="fks-empty">No people match these filters.</div>
            )}
          </div>
        </div>
        {status !== "ready" && (
          <div
            className="fks-status"
            role={status === "error" ? "alert" : "status"}
          >
            <span className={status === "loading" ? "fks-spinner" : undefined} />
            {status === "loading" ? "Loading schedule…" : errorMessage}
          </div>
        )}
      </div>
      {contextMenu && (
        <OverlayPortal
          anchor={contextMenu.anchor}
          className="fks-context-menu"
          role="menu"
          width={210}
          onDismiss={() => setContextMenu(null)}
        >
          {props.onEntryOpen && (
            <button
              type="button"
              role="menuitem"
              autoFocus
              onClick={() => openEntry(contextMenu.entry)}
            >
              <span aria-hidden="true">✎</span>
              Edit allocation
            </button>
          )}
          {props.onDeleteRequest && !contextMenu.entry.readOnly && (
            <button
              type="button"
              role="menuitem"
              autoFocus={!props.onEntryOpen}
              className="fks-context-menu__danger"
              onClick={() => {
                const entry = contextMenu.entry;
                setContextMenu(null);
                void deleteEntry(entry);
              }}
            >
              <span aria-hidden="true">×</span>
              Delete allocation
            </button>
          )}
        </OverlayPortal>
      )}
      {hover && (
        <OverlayPortal
          anchor={hover.anchor}
          className="fks-hover-card"
          role="tooltip"
          onDismiss={() => setHover(null)}
        >
          {props.renderHoverCard ? (
            props.renderHoverCard({
              entry: hover.entry,
              person: people.find((person) => person.id === hover.entry.personId),
              project: hover.entry.projectId
                ? projectsById.get(hover.entry.projectId)
                : undefined,
              dismiss: () => setHover(null)
            })
          ) : (
            <DefaultHover
              entry={hover.entry}
              project={
                hover.entry.projectId
                  ? projectsById.get(hover.entry.projectId)
                  : undefined
              }
            />
          )}
        </OverlayPortal>
      )}
      {notices.length > 0 && (
        <div className="fks-toast-stack" aria-label="Schedule notifications">
          {notices.map((notice) => (
            <div
              key={notice.id}
              className={`fks-toast fks-toast--${notice.tone}`}
              role={notice.tone === "error" ? "alert" : "status"}
            >
              <span>{notice.message}</span>
              <button
                type="button"
                aria-label="Dismiss notification"
                onClick={() => dismissNotice(notice.id)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function FilterButton({
  label,
  icon,
  count,
  open,
  onClick,
  menuClassName,
  children
}: {
  label: string;
  icon?: string;
  count: number;
  open: boolean;
  onClick: () => void;
  menuClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="fks-filter">
      <button
        type="button"
        className={count ? "fks-filter-button fks-filter-button--active" : "fks-filter-button"}
        aria-expanded={open}
        onClick={onClick}
      >
        {icon && <span className="fks-filter-button__icon" aria-hidden="true">{icon}</span>}
        <span className="fks-filter-button__label">{label}</span>
        {count > 0 && <span className="fks-filter-button__count">{count}</span>}
      </button>
      {open && (
        <div className={`fks-filter-menu${menuClassName ? ` ${menuClassName}` : ""}`}>
          {children}
        </div>
      )}
    </div>
  );
}

function MenuSearch({
  label,
  value,
  onChange
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="fks-menu-search">
      <span aria-hidden="true">⌕</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={label}
        aria-label={label}
        autoFocus
      />
    </label>
  );
}

function FilterEmpty({ label = "No matches found." }: { label?: string }) {
  return <p className="fks-filter-empty">{label}</p>;
}

function FilterOption({
  checked,
  label,
  onChange
}: {
  checked: boolean;
  label: string;
  onChange: () => void;
}) {
  return (
    <label className="fks-filter-option">
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span>{label}</span>
    </label>
  );
}

function SortOption({
  checked,
  label,
  onChange
}: {
  checked: boolean;
  label: string;
  onChange: () => void;
}) {
  return (
    <label className="fks-filter-option">
      <input type="radio" name="fks-people-sort" checked={checked} onChange={onChange} />
      <span>{label}</span>
    </label>
  );
}

function DefaultHover({
  entry,
  project
}: {
  entry: SchedulerEntry;
  project?: SchedulerProject | undefined;
}) {
  return (
    <>
      <span className="fks-hover-card__eyebrow">
        {entry.kind === "absence" ? "Absence" : project?.customerName ?? "Allocation"}
      </span>
      <strong>{entry.title ?? project?.name ?? "Scheduled time"}</strong>
      {entry.details && <p>{entry.details}</p>}
      <dl>
        <div>
          <dt>Dates</dt>
          <dd>
            {entry.startDate} – {entry.endDate}
          </dd>
        </div>
        <div>
          <dt>Daily load</dt>
          <dd>{entry.hoursPerDay} hours</dd>
        </div>
      </dl>
    </>
  );
}
