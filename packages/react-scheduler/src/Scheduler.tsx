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
  capacityKey,
  entryGeometry,
  filterPeopleAndEntries,
  overflowGeometry,
  packEntries,
  type CapacityState
} from "./layout";
import type { InteractionState } from "./interaction";
import type {
  CreateDraft,
  EntryRenderContext,
  SchedulerEntry,
  SchedulerFilters,
  SchedulerPerson,
  SchedulerProject,
  SchedulerProps,
  SchedulerViewport,
  VisibleRange
} from "./types";
import { OverlayPortal } from "./HoverPortal";
import { useFixedVirtualRows } from "./useFixedVirtualRows";
import { usePointerInteraction } from "./usePointerInteraction";
import "./styles.css";

const PERSON_COLUMN_WIDTH = 216;
const MIN_DAY_WIDTH = { day: 240, week: 92, month: 34 } as const;

type AnySchedulerProps = SchedulerProps<unknown, unknown, unknown>;

interface HoverState {
  entry: SchedulerEntry;
  anchor: DOMRect;
}

interface OverflowState {
  person: SchedulerPerson;
  entries: SchedulerEntry[];
  anchor: DOMRect;
}

interface RowProps {
  person: SchedulerPerson;
  entries: SchedulerEntry[];
  projects: Map<string, SchedulerProject>;
  range: VisibleRange;
  days: string[];
  dayWidth: number;
  rowHeight: number;
  capacityMap: Map<string, CapacityState>;
  pendingIds: Set<string>;
  createDraft?: CreateDraft;
  renderEntryContent?: AnySchedulerProps["renderEntryContent"];
  renderPersonCell?: AnySchedulerProps["renderPersonCell"];
  onStartEntry: ReturnType<typeof usePointerInteraction>["startEntry"];
  onStartCreate: ReturnType<typeof usePointerInteraction>["startCreate"];
  onHover: (entry: SchedulerEntry, anchor: DOMRect) => void;
  onHoverCancel: () => void;
  onOpen: (entry: SchedulerEntry) => void;
  onDelete: (entry: SchedulerEntry) => void;
  onOverflow: (
    person: SchedulerPerson,
    entries: SchedulerEntry[],
    anchor: DOMRect
  ) => void;
}

const SchedulerRow = memo(function SchedulerRow({
  person,
  entries,
  projects,
  range,
  days,
  dayWidth,
  rowHeight,
  capacityMap,
  pendingIds,
  createDraft,
  renderEntryContent,
  renderPersonCell,
  onStartEntry,
  onStartCreate,
  onHover,
  onHoverCancel,
  onOpen,
  onDelete,
  onOverflow
}: RowProps) {
  const packed = packEntries(entries, range);
  const overflow = overflowGeometry(packed.overflow, range, dayWidth);
  return (
    <div
      className="fks-row"
      data-person-id={person.id}
      style={{ height: rowHeight, width: PERSON_COLUMN_WIDTH + days.length * dayWidth }}
      role="row"
    >
      <div
        className="fks-person-cell"
        style={{ width: PERSON_COLUMN_WIDTH }}
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
              <strong>{person.name}</strong>
              {person.secondaryText && <small>{person.secondaryText}</small>}
            </span>
          </>
        )}
      </div>
      <div
        className="fks-timeline-row"
        style={{
          left: PERSON_COLUMN_WIDTH,
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
              }${capacity?.status === "empty" ? " fks-day-cell--unavailable" : ""}`}
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
                top: 4 + lane * ((rowHeight - 10) / 2),
                height: (rowHeight - 14) / 2,
                "--fks-entry-accent":
                  entry.appearance?.accentColor ??
                  project?.accentColor ??
                  "var(--fks-accent)"
              } as React.CSSProperties}
              onPointerDown={(event) => onStartEntry(event, entry, "move")}
              onDoubleClick={() => onOpen(entry)}
              onMouseEnter={(event) =>
                onHover(entry, event.currentTarget.getBoundingClientRect())
              }
              onMouseLeave={onHoverCancel}
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
              height: (rowHeight - 14) / 2
            }}
          >
            New allocation
          </div>
        )}
        {overflow && (
          <button
            type="button"
            className="fks-overflow-button"
            style={{ left: overflow.left + 4, width: Math.max(32, overflow.width - 8) }}
            onClick={(event) =>
              onOverflow(
                person,
                packed.overflow,
                event.currentTarget.getBoundingClientRect()
              )
            }
            aria-label={`Show ${packed.overflow.length} more entries for ${person.name}`}
          >
            +{packed.overflow.length}
          </button>
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
    status = "ready",
    errorMessage = "The schedule could not be loaded.",
    ariaLabel = "Employee schedule"
  } = props;
  const hoverTimerRef = useRef<number>();
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(960);
  const [openFilter, setOpenFilter] = useState<"people" | "projects" | null>(
    null
  );
  const [hover, setHover] = useState<HoverState | null>(null);
  const [overflow, setOverflow] = useState<OverflowState | null>(null);
  const [pendingPreviews, setPendingPreviews] = useState<
    Map<string, SchedulerEntry>
  >(new Map());
  const [pendingCreate, setPendingCreate] = useState<CreateDraft | undefined>();
  const [message, setMessage] = useState<string>();
  const captureScrollElement = useCallback(
    (node: HTMLDivElement | null) => setScrollElement(node),
    []
  );

  const range = useMemo(
    () => getVisibleRange(viewport, weekStartsOn),
    [viewport, weekStartsOn]
  );
  const days = useMemo(() => eachDay(range), [range]);
  const timelineAvailable = Math.max(320, containerWidth - PERSON_COLUMN_WIDTH);
  const dayWidth = Math.max(
    MIN_DAY_WIDTH[viewport.zoom],
    timelineAvailable / Math.max(1, days.length)
  );
  const rowHeight = density === "compact" ? 48 : 64;
  const projectsById = useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects]
  );
  const filtered = useMemo(
    () =>
      filterPeopleAndEntries(
        filters.personIds,
        filters.projectIds,
        filters.query,
        people,
        entries
      ),
    [entries, filters, people]
  );
  const filteredPeople = useMemo(
    () => people.filter((person) => filtered.personIdSet.has(person.id)),
    [filtered.personIdSet, people]
  );
  const effectiveEntries = useMemo(() => {
    const previewIds = new Set(pendingPreviews.keys());
    const values = filtered.entries
      .filter((entry) => !previewIds.has(entry.id))
      .concat(
        Array.from(pendingPreviews.values()).filter((entry) =>
          filtered.personIdSet.has(entry.personId)
        )
      );
    return values;
  }, [filtered.entries, filtered.personIdSet, pendingPreviews]);
  const entriesByPerson = useMemo(() => {
    const map = new Map<string, SchedulerEntry[]>();
    for (const entry of effectiveEntries) {
      const current = map.get(entry.personId);
      if (current) current.push(entry);
      else map.set(entry.personId, [entry]);
    }
    return map;
  }, [effectiveEntries]);
  const capacityMap = useMemo(
    () => buildCapacityMap(capacity, effectiveEntries),
    [capacity, effectiveEntries]
  );
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

  const finishInteraction = useCallback(
    async (interaction: InteractionState<unknown>) => {
      setMessage(undefined);
      if (interaction.mode === "create" && interaction.createDraft) {
        const callback = props.onCreateRequest;
        if (!callback) return;
        setPendingCreate(interaction.createDraft);
        try {
          const decision = await callback(interaction.createDraft);
          if (!decision.accepted)
            setMessage(decision.reason ?? "Creation was rejected.");
        } catch (error) {
          setMessage(error instanceof Error ? error.message : "Creation failed.");
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
        if (decision && !decision.accepted)
          setMessage(decision.reason ?? "The change was rejected.");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "The change failed.");
      } finally {
        setPendingPreviews((current) => {
          const next = new Map(current);
          next.delete(previous.id);
          return next;
        });
      }
    },
    [
      props.onCreateRequest,
      props.onMoveRequest,
      props.onResizeRequest
    ]
  );

  const pointer = usePointerInteraction({
    scrollElement,
    range,
    dayWidth,
    personColumnWidth: PERSON_COLUMN_WIDTH,
    onFinish: finishInteraction
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
  const virtualizer = useFixedVirtualRows({
    scrollElement,
    count: filteredPeople.length,
    rowHeight,
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

  const deleteEntry = useCallback(
    async (entry: SchedulerEntry) => {
      if (!props.onDeleteRequest || entry.readOnly) return;
      setMessage(undefined);
      setPendingPreviews((current) => new Map(current).set(entry.id, entry));
      try {
        const decision = await props.onDeleteRequest(entry);
        if (!decision.accepted)
          setMessage(decision.reason ?? "Deletion was rejected.");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Deletion failed.");
      } finally {
        setPendingPreviews((current) => {
          const next = new Map(current);
          next.delete(entry.id);
          return next;
        });
      }
    },
    [props.onDeleteRequest]
  );

  const showHover = useCallback((entry: SchedulerEntry, anchor: DOMRect) => {
    window.clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = window.setTimeout(
      () => setHover({ entry, anchor }),
      260
    );
  }, []);
  const cancelHover = useCallback(
    () => window.clearTimeout(hoverTimerRef.current),
    []
  );
  const openEntry = useCallback(
    (entry: SchedulerEntry) => props.onEntryOpen?.(entry),
    [props.onEntryOpen]
  );
  const openOverflow = useCallback(
    (
      targetPerson: SchedulerPerson,
      targetEntries: SchedulerEntry[],
      anchor: DOMRect
    ) =>
      setOverflow({
        person: targetPerson,
        entries: targetEntries,
        anchor
      }),
    []
  );

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
    >
      <div className="fks-toolbar">
        <div className="fks-toolbar__filters">
          <label className="fks-search">
            <span aria-hidden="true">⌕</span>
            <input
              value={filters.query}
              onChange={(event) =>
                onFiltersChange({ ...filters, query: event.target.value })
              }
              placeholder="Search people"
              aria-label="Search people"
            />
          </label>
          <FilterButton
            label="People"
            count={filters.personIds.length}
            open={openFilter === "people"}
            onClick={() =>
              setOpenFilter((value) => (value === "people" ? null : "people"))
            }
          >
            {people.map((person) => (
              <FilterOption
                key={person.id}
                checked={filters.personIds.includes(person.id)}
                label={person.name}
                onChange={() => changeSelection("personIds", person.id)}
              />
            ))}
          </FilterButton>
          <FilterButton
            label="Projects"
            count={filters.projectIds.length}
            open={openFilter === "projects"}
            onClick={() =>
              setOpenFilter((value) => (value === "projects" ? null : "projects"))
            }
          >
            {projects.map((project) => (
              <FilterOption
                key={project.id}
                checked={filters.projectIds.includes(project.id)}
                label={`${project.name}${project.customerName ? ` · ${project.customerName}` : ""}`}
                onChange={() => changeSelection("projectIds", project.id)}
              />
            ))}
          </FilterButton>
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
            Today
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
              {zoom[0]?.toUpperCase()}
              {zoom.slice(1)}
            </button>
          ))}
        </div>
      </div>
      {message && (
        <div className="fks-message" role="status">
          {message}
          <button type="button" onClick={() => setMessage(undefined)}>
            Dismiss
          </button>
        </div>
      )}
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
            width: PERSON_COLUMN_WIDTH + days.length * dayWidth,
            minHeight: "100%"
          }}
        >
          <div
            className="fks-header"
            style={{ width: PERSON_COLUMN_WIDTH + days.length * dayWidth }}
            role="row"
          >
            <div
              className="fks-person-header"
              style={{ width: PERSON_COLUMN_WIDTH }}
            >
              <span>{filteredPeople.length} people</span>
              <small>Capacity</small>
            </div>
            <div
              className="fks-date-header"
              style={{
                left: PERSON_COLUMN_WIDTH,
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
                    range={range}
                    days={days}
                    dayWidth={dayWidth}
                    rowHeight={rowHeight}
                    capacityMap={capacityMap}
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
                    onOpen={openEntry}
                    onDelete={deleteEntry}
                    onOverflow={openOverflow}
                  />
                </div>
              );
            })}
          </div>
          {!filteredPeople.length && status === "ready" && (
            <div className="fks-empty">No people match these filters.</div>
          )}
        </div>
        {status !== "ready" && (
          <div className="fks-status" role={status === "error" ? "alert" : "status"}>
            {status === "loading" ? "Loading schedule…" : errorMessage}
          </div>
        )}
      </div>
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
      {overflow && (
        <OverlayPortal
          anchor={overflow.anchor}
          className="fks-overflow-panel"
          onDismiss={() => setOverflow(null)}
        >
          <header>
            <strong>{overflow.person.name}</strong>
            <span>{overflow.entries.length} overlapping entries</span>
          </header>
          {overflow.entries.map((entry) => (
            <button
              type="button"
              key={entry.id}
              onClick={() => {
                setOverflow(null);
                props.onEntryOpen?.(entry);
              }}
            >
              <strong>
                {entry.title ??
                  (entry.projectId
                    ? projectsById.get(entry.projectId)?.name
                    : "Absence")}
              </strong>
              <span>
                {entry.startDate} – {entry.endDate} · {entry.hoursPerDay}h/day
              </span>
            </button>
          ))}
        </OverlayPortal>
      )}
    </section>
  );
}

function FilterButton({
  label,
  count,
  open,
  onClick,
  children
}: {
  label: string;
  count: number;
  open: boolean;
  onClick: () => void;
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
        {label}
        {count > 0 && <span>{count}</span>}
      </button>
      {open && <div className="fks-filter-menu">{children}</div>}
    </div>
  );
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
