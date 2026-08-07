import {
  getVisibleRange,
  Scheduler,
  todayKey,
  type CreateDraft,
  type EntryMutation,
  type MutationDecision,
  type ResizeMutation,
  type SchedulerEntry,
  type SchedulerFilters,
  type SchedulerProject,
  type SchedulerViewport,
  type SchedulerZoom,
  type VisibleRange
} from "@flowkify/scheduler";
import "@flowkify/scheduler/styles.css";
import * as React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type AllocationCreateInput,
  DataverseSchedulerRepository,
  DEFAULT_PROJECT_COLOR,
  type FlowkifyEntryMetadata,
  type LoadedSchedule,
  type MutationScope,
  RECURRENCE_OPTIONS,
  type RecurrencePattern,
  validateAllocationCreate
} from "./DataverseSchedulerRepository";
import "./host.css";

export interface FlowkifySchedulerHostProps {
  repository: DataverseSchedulerRepository;
  height: number;
  defaultZoom: SchedulerZoom;
  onProjectOpenInDataverse: (projectId: string) => Promise<void>;
  onEntrySelected: (entryId: string) => void;
}

interface ScopePrompt {
  entry: SchedulerEntry<FlowkifyEntryMetadata>;
  resolve: (scope: MutationScope | "cancel") => void;
}

interface DeletePrompt {
  entry: SchedulerEntry<FlowkifyEntryMetadata>;
  resolve: (scope: MutationScope | "cancel") => void;
}

interface CreatePrompt {
  draft: CreateDraft;
  resolve: (decision: MutationDecision) => void;
}

const emptySchedule: LoadedSchedule = {
  people: [],
  projects: [],
  entries: [],
  capacity: []
};

export function FlowkifySchedulerHost({
  repository,
  height,
  defaultZoom,
  onProjectOpenInDataverse,
  onEntrySelected
}: FlowkifySchedulerHostProps): JSX.Element {
  const [schedule, setSchedule] = useState(emptySchedule);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading"
  );
  const [error, setError] = useState<string>();
  const [viewport, setViewport] = useState<SchedulerViewport>({
    zoom: defaultZoom,
    anchorDate: todayKey()
  });
  const [filters, setFilters] = useState<SchedulerFilters>({
    query: "",
    personIds: [],
    projectIds: [],
    capacityStatuses: [],
    peopleSort: "name-asc"
  });
  const [showWeekends, setShowWeekends] = useState(false);
  const [scopePrompt, setScopePrompt] = useState<ScopePrompt>();
  const [deletePrompt, setDeletePrompt] = useState<DeletePrompt>();
  const [createPrompt, setCreatePrompt] = useState<CreatePrompt>();
  const [projectColorProject, setProjectColorProject] =
    useState<SchedulerProject>();
  const [opened, setOpened] =
    useState<SchedulerEntry<FlowkifyEntryMetadata>>();
  const requestGeneration = useRef(0);
  const previousDefaultZoom = useRef(defaultZoom);
  const range = getVisibleRange(viewport);

  useEffect(() => {
    if (previousDefaultZoom.current === defaultZoom) return;
    const previous = previousDefaultZoom.current;
    previousDefaultZoom.current = defaultZoom;
    setViewport((current) =>
      applyDefaultZoomChange(current, previous, defaultZoom, todayKey())
    );
  }, [defaultZoom]);

  const reload = useCallback(
    async (requestedRange: VisibleRange): Promise<boolean> => {
      const generation = ++requestGeneration.current;
      setStatus("loading");
      try {
        const loaded = await repository.load(requestedRange);
        if (generation !== requestGeneration.current) return false;
        setSchedule(loaded);
        setStatus("ready");
        setError(undefined);
        return true;
      } catch (reason) {
        if (generation !== requestGeneration.current) return false;
        setStatus("error");
        setError(
          reason instanceof Error
            ? reason.message
            : "Dataverse could not load the schedule."
        );
        return false;
      }
    },
    [repository]
  );

  useEffect(() => {
    void reload(range);
  }, [range.startDate, range.endDate, reload]);

  const chooseScope = useCallback(
    (entry: SchedulerEntry<FlowkifyEntryMetadata>): Promise<MutationScope | "cancel"> => {
      if (!entry.metadata?.seriesId) return Promise.resolve("occurrence");
      return new Promise((resolve) => setScopePrompt({ entry, resolve }));
    },
    []
  );

  const confirmDelete = useCallback(
    (entry: SchedulerEntry<FlowkifyEntryMetadata>) =>
      new Promise<MutationScope | "cancel">((resolve) =>
        setDeletePrompt({ entry, resolve })
      ),
    []
  );

  const updateEntry = useCallback(
    async (
      mutation:
        | EntryMutation<FlowkifyEntryMetadata>
        | ResizeMutation<FlowkifyEntryMetadata>
    ): Promise<MutationDecision> => {
      const scope = await chooseScope(mutation.entry);
      if (scope === "cancel") return { accepted: false, silent: true };
      try {
        await repository.update(mutation, scope);
        await reload(range);
        return { accepted: true };
      } catch (reason) {
        return {
          accepted: false,
          reason:
            reason instanceof Error ? reason.message : "Dataverse rejected the change."
        };
      }
    },
    [chooseScope, range, reload, repository]
  );

  const deleteEntry = useCallback(
    async (
      entry: SchedulerEntry<FlowkifyEntryMetadata>
    ): Promise<MutationDecision> => {
      const scope = await confirmDelete(entry);
      if (scope === "cancel") return { accepted: false, silent: true };
      try {
        await repository.delete(entry, scope);
        await reload(range);
        return { accepted: true };
      } catch (reason) {
        return {
          accepted: false,
          reason:
            reason instanceof Error
              ? reason.message
              : "Dataverse rejected the deletion."
        };
      }
    },
    [confirmDelete, range, reload, repository]
  );

  const requestCreate = useCallback(
    (draft: CreateDraft): Promise<MutationDecision> =>
      new Promise((resolve) => setCreatePrompt({ draft, resolve })),
    []
  );

  const openSeries = useCallback(
    async (id: string) => {
      const entry =
        schedule.entries.find(
          (candidate) => candidate.metadata?.occurrenceId === id
        ) ?? (await repository.getAllocation(id));
      setOpened(entry);
      onEntrySelected(entry.id);
    },
    [onEntrySelected, repository, schedule.entries]
  );

  const closeScope = (choice: MutationScope | "cancel") => {
    scopePrompt?.resolve(choice);
    setScopePrompt(undefined);
  };

  const closeDelete = (choice: MutationScope | "cancel") => {
    deletePrompt?.resolve(choice);
    setDeletePrompt(undefined);
  };

  return (
    <div className="fks-pcf-host" style={{ height }}>
      <Scheduler
        people={schedule.people}
        projects={schedule.projects}
        entries={schedule.entries}
        capacity={schedule.capacity}
        viewport={viewport}
        filters={filters}
        status={status}
        personColumnWidth={180}
        showWeekends={showWeekends}
        onShowWeekendsChange={setShowWeekends}
        errorMessage={error ?? "Dataverse could not load the schedule."}
        onViewportChange={setViewport}
        onFiltersChange={setFilters}
        onCreateRequest={requestCreate}
        onMoveRequest={updateEntry}
        onResizeRequest={updateEntry}
        onDeleteRequest={deleteEntry}
        onEntryOpen={(entry) => {
          setOpened(entry);
          onEntrySelected(entry.id);
        }}
        renderHoverCard={({ entry, project }) => (
          <div className="fks-pcf-hover">
            <span>{entry.kind === "absence" ? "Absence" : project?.customerName}</span>
            <strong>{entry.title ?? project?.name}</strong>
            {entry.details && <p>{entry.details}</p>}
            <footer>
              <b>{entry.hoursPerDay}h/day</b>
              {entry.metadata?.seriesId && <span>Recurring</span>}
            </footer>
          </div>
        )}
      />
      {scopePrompt && (
        <RecurringScopeDialog
          prompt={scopePrompt}
          onChoose={closeScope}
          onOpenSeries={openSeries}
        />
      )}
      {deletePrompt && (
        <DeleteAllocationDialog
          prompt={deletePrompt}
          onChoose={closeDelete}
        />
      )}
      {createPrompt && (
        <AllocationDialog
          mode="create"
          initial={{
            projectId: "",
            personId: createPrompt.draft.personId,
            notes: "",
            startDate: createPrompt.draft.startDate,
            endDate: createPrompt.draft.endDate,
            hoursPerDay: 8,
            recurrencePattern: RECURRENCE_OPTIONS[0].value
          }}
          people={schedule.people}
          projects={schedule.projects}
          onEditProjectColor={setProjectColorProject}
          onOpenProjectInDataverse={onProjectOpenInDataverse}
          onCancel={() => {
            createPrompt.resolve({ accepted: false, silent: true });
            setCreatePrompt(undefined);
          }}
          onSubmit={async (input) => {
            await repository.create(input);
            await reload(range);
            createPrompt.resolve({ accepted: true });
            setCreatePrompt(undefined);
          }}
        />
      )}
      {opened?.metadata?.source === "allocation" && (
        <AllocationDialog
          key={opened.id}
          mode="edit"
          entry={opened}
          initial={allocationInputFromEntry(opened)}
          people={schedule.people}
          projects={schedule.projects}
          onEditProjectColor={setProjectColorProject}
          onOpenProjectInDataverse={onProjectOpenInDataverse}
          onCancel={() => setOpened(undefined)}
          onSubmit={async (input) => {
            await repository.updateAllocation(opened, input);
            await reload(range);
            setOpened(undefined);
          }}
          onDelete={async () => {
            const decision = await deleteEntry(opened);
            if (decision.accepted) setOpened(undefined);
          }}
          onOpenSeries={openSeries}
        />
      )}
      {projectColorProject && (
        <ProjectColorDialog
          key={projectColorProject.id}
          project={projectColorProject}
          onCancel={() => setProjectColorProject(undefined)}
          onSubmit={async (color) => {
            await repository.updateProjectColor(projectColorProject.id, color);
            await reload(range);
            setProjectColorProject(undefined);
          }}
        />
      )}
      {opened?.metadata?.source !== "allocation" && opened && (
        <HostDialog
          title={opened.title ?? "Schedule entry"}
          onDismiss={() => setOpened(undefined)}
        >
          <dl className="fks-host-details">
            <div>
              <dt>Dates</dt>
              <dd>
                {opened.startDate} – {opened.endDate}
              </dd>
            </div>
            <div>
              <dt>Daily load</dt>
              <dd>{opened.hoursPerDay} hours</dd>
            </div>
            <div>
              <dt>Dataverse ID</dt>
              <dd>{opened.metadata?.occurrenceId}</dd>
            </div>
          </dl>
          <div className="fks-host-dialog__actions">
            <button
              type="button"
              className="fks-host-primary"
              onClick={() => setOpened(undefined)}
            >
              Close
            </button>
          </div>
        </HostDialog>
      )}
    </div>
  );
}

export function applyDefaultZoomChange(
  viewport: SchedulerViewport,
  previousDefault: SchedulerZoom,
  nextDefault: SchedulerZoom,
  today: string
): SchedulerViewport {
  return previousDefault === nextDefault
    ? viewport
    : { zoom: nextDefault, anchorDate: today };
}

function seriesRootId(
  entry: SchedulerEntry<FlowkifyEntryMetadata>
): string | undefined {
  return entry.metadata?.rootAllocationId ?? entry.metadata?.seriesId;
}

function RecurringScopeDialog({
  prompt,
  onChoose,
  onOpenSeries
}: {
  prompt: ScopePrompt;
  onChoose: (scope: MutationScope | "cancel") => void;
  onOpenSeries: (id: string) => Promise<void>;
}) {
  const rootId = seriesRootId(prompt.entry);
  const rootSelected = rootId === prompt.entry.metadata?.occurrenceId;
  return (
    <HostDialog
      title="Update recurring allocation?"
      onDismiss={() => onChoose("cancel")}
    >
      <span className="fks-host-series-badge">Recurring series</span>
      <p className="fks-host-dialog__intro">
        <strong>{prompt.entry.title}</strong>{" "}
        {rootSelected
          ? "is the root allocation that controls this series."
          : "is one occurrence in a recurring series."}
      </p>
      <div className="fks-host-scope-options">
        {!rootSelected && (
          <button type="button" onClick={() => onChoose("occurrence")}>
            <strong>Update this occurrence</strong>
            <span>Only the selected dates are changed.</span>
          </button>
        )}
        <button
          type="button"
          className="fks-host-primary"
          onClick={() => onChoose("series")}
        >
          <strong>Update entire series</strong>
          <span>Apply this change through the root allocation.</span>
        </button>
      </div>
      {rootId && (
        <SeriesLink
          entry={prompt.entry}
          onOpen={onOpenSeries}
          onOpened={() => onChoose("cancel")}
        />
      )}
    </HostDialog>
  );
}

function DeleteAllocationDialog({
  prompt,
  onChoose
}: {
  prompt: DeletePrompt;
  onChoose: (scope: MutationScope | "cancel") => void;
}) {
  const rootId = seriesRootId(prompt.entry);
  const rootSelected = rootId === prompt.entry.metadata?.occurrenceId;
  if (rootId && !rootSelected)
    return (
      <HostDialog
        title="Delete recurring allocation?"
        elevated
        onDismiss={() => onChoose("cancel")}
      >
        <p className="fks-host-dialog__intro">
          Choose whether to delete only this occurrence or the complete recurring
          series.
        </p>
        <div className="fks-host-scope-options">
          <button
            type="button"
            className="fks-host-danger"
            onClick={() => onChoose("occurrence")}
          >
            <strong>Delete this occurrence</strong>
            <span>The rest of the series remains scheduled.</span>
          </button>
          <button
            type="button"
            className="fks-host-danger"
            onClick={() => onChoose("series")}
          >
            <strong>Delete entire series</strong>
            <span>Remove the root and every generated occurrence.</span>
          </button>
        </div>
        <div className="fks-host-dialog__actions">
          <button type="button" onClick={() => onChoose("cancel")}>Cancel</button>
        </div>
      </HostDialog>
    );
  return (
    <HostDialog
      title={rootSelected ? "Delete recurring series?" : "Delete allocation?"}
      elevated
      onDismiss={() => onChoose("cancel")}
    >
      <div className="fks-host-delete-warning" role="alert">
        <strong>
          {rootSelected
            ? "This action deletes the entire recurring series."
            : "This action cannot be undone."}
        </strong>
        <span>
          {rootSelected
            ? "The root allocation and every generated occurrence will be permanently removed."
            : `“${prompt.entry.title ?? "This allocation"}” will be permanently removed.`}
        </span>
      </div>
      <div className="fks-host-dialog__actions">
        <button type="button" onClick={() => onChoose("cancel")}>Cancel</button>
        <button
          type="button"
          className="fks-host-delete"
          onClick={() => onChoose(rootSelected ? "series" : "occurrence")}
        >
          {rootSelected ? "Delete entire series" : "Delete allocation"}
        </button>
      </div>
    </HostDialog>
  );
}

function SeriesLink({
  entry,
  onOpen,
  onOpened
}: {
  entry: SchedulerEntry<FlowkifyEntryMetadata>;
  onOpen: (id: string) => Promise<void>;
  onOpened?: () => void;
}) {
  const rootId = seriesRootId(entry);
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string>();
  if (!rootId) return null;
  return (
    <aside className="fks-host-series-link">
      <div>
        <strong>Need to change the recurrence?</strong>
        <span>Pattern and end date are managed on the root allocation.</span>
      </div>
      <button
        type="button"
        disabled={opening}
        onClick={async () => {
          setOpening(true);
          setOpenError(undefined);
          try {
            await onOpen(rootId);
            onOpened?.();
          } catch (reason) {
            setOpening(false);
            setOpenError(
              reason instanceof Error
                ? reason.message
                : "The recurring series could not be opened."
            );
          }
        }}
      >
        {opening ? "Opening…" : "Edit recurring series"}
      </button>
      {openError && <p role="alert">{openError}</p>}
    </aside>
  );
}

function HostDialog({
  title,
  onDismiss,
  compact = false,
  elevated = false,
  children
}: {
  title: string;
  onDismiss: () => void;
  compact?: boolean;
  elevated?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`fks-host-backdrop${elevated ? " fks-host-backdrop--elevated" : ""}`}
      role="presentation"
      onKeyDown={(event) => {
        if (event.key === "Escape") onDismiss();
      }}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onDismiss();
      }}
    >
      <section
        className={`fks-host-dialog${compact ? " fks-host-dialog--compact" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header>
          <h2>{title}</h2>
          <button type="button" onClick={onDismiss} aria-label="Close dialog">
            ×
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

function ProjectColorDialog({
  project,
  onCancel,
  onSubmit
}: {
  project: SchedulerProject;
  onCancel: () => void;
  onSubmit: (color: string) => Promise<void>;
}) {
  const [color, setColor] = useState(
    project.accentColor ?? DEFAULT_PROJECT_COLOR
  );
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string>();
  return (
    <HostDialog
      title="Project colour"
      compact
      elevated
      onDismiss={() => {
        if (!saving) onCancel();
      }}
    >
      <p className="fks-host-dialog__intro">
        Choose the allocation colour for <strong>{project.name}</strong>.
      </p>
      <form
        className="fks-project-color-form"
        aria-busy={saving}
        onSubmit={async (event) => {
          event.preventDefault();
          setSaving(true);
          setSubmitError(undefined);
          try {
            await onSubmit(color);
          } catch (reason) {
            setSaving(false);
            setSubmitError(
              reason instanceof Error
                ? reason.message
                : "Dataverse rejected the project colour."
            );
          }
        }}
      >
        <label>
          <span>Colour</span>
          <span className="fks-project-color-picker">
            <input
              type="color"
              value={color}
              aria-label="Choose project colour"
              onChange={(event) => setColor(event.target.value.toUpperCase())}
            />
            <output>{color}</output>
          </span>
        </label>
        {submitError && (
          <p className="fks-host-form-error" role="alert">
            {submitError}
          </p>
        )}
        <div className="fks-host-dialog__actions">
          <button type="button" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="fks-host-primary" disabled={saving}>
            {saving ? "Saving…" : "Save colour"}
          </button>
        </div>
      </form>
    </HostDialog>
  );
}

function AllocationDialog({
  mode,
  initial,
  entry,
  people,
  projects,
  onCancel,
  onSubmit,
  onEditProjectColor,
  onOpenProjectInDataverse,
  onDelete,
  onOpenSeries
}: {
  mode: "create" | "edit";
  initial: AllocationCreateInput;
  entry?: SchedulerEntry<FlowkifyEntryMetadata>;
  people: LoadedSchedule["people"];
  projects: readonly SchedulerProject[];
  onCancel: () => void;
  onSubmit: (input: AllocationCreateInput) => Promise<void>;
  onEditProjectColor: (project: SchedulerProject) => void;
  onOpenProjectInDataverse: (projectId: string) => Promise<void>;
  onDelete?: () => Promise<void>;
  onOpenSeries?: (id: string) => Promise<void>;
}) {
  const [projectId, setProjectId] = useState(initial.projectId);
  const [personId, setPersonId] = useState(initial.personId);
  const [notes, setNotes] = useState(initial.notes);
  const [startDate, setStartDate] = useState(initial.startDate);
  const [endDate, setEndDate] = useState(initial.endDate);
  const [hours, setHours] = useState(initial.hoursPerDay);
  const [recurrencePattern, setRecurrencePattern] =
    useState<RecurrencePattern>(initial.recurrencePattern);
  const [recurrenceEndDate, setRecurrenceEndDate] = useState(
    initial.recurrenceEndDate ?? ""
  );
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string>();
  const selectedPerson = people.find((person) => person.id === personId);
  const selectedProject = projects.find((project) => project.id === projectId);
  const recurrenceEditable = !entry?.metadata?.rootAllocationId;
  const repeating = recurrencePattern !== RECURRENCE_OPTIONS[0].value;
  const input: AllocationCreateInput = {
    projectId,
    personId,
    notes,
    startDate,
    endDate,
    hoursPerDay: hours,
    recurrencePattern,
    ...(repeating ? { recurrenceEndDate } : {})
  };
  const validationError = validateAllocationCreate(input);
  return (
    <HostDialog
      title={mode === "create" ? "Create allocation" : "Edit allocation"}
      compact
      onDismiss={() => {
        if (!saving) onCancel();
      }}
    >
      <div className="fks-allocation-summary">
        <span className="fks-allocation-avatar" aria-hidden="true">
          {initials(selectedPerson?.name ?? "Allocation")}
        </span>
        <div>
          <strong>{selectedPerson?.name ?? "Select a person"}</strong>
          <span>{formatAllocationRange(startDate, endDate)}</span>
        </div>
      </div>
      <form
        className="fks-allocation-form"
        aria-busy={saving}
        noValidate
        onSubmit={async (event) => {
          event.preventDefault();
          setAttempted(true);
          if (validationError) return;
          setSaving(true);
          setSubmitError(undefined);
          try {
            await onSubmit(input);
          } catch (reason) {
            setSaving(false);
            setSubmitError(
              reason instanceof Error
                ? reason.message
                : "Dataverse rejected the allocation."
            );
          }
        }}
      >
        <SearchSelect
          label="Project"
          placeholder="Search projects or companies"
          value={projectId}
          required
          invalid={attempted && !projectId}
          options={projects.map((project) => ({
            id: project.id,
            label: project.name,
            description: project.customerName,
            color: project.accentColor ?? DEFAULT_PROJECT_COLOR
          }))}
          onChange={(value) => {
            setProjectId(value);
            setSubmitError(undefined);
          }}
        />
        {selectedProject && (
          <div className="fks-project-actions">
            <button
              type="button"
              className="fks-project-color-action"
              disabled={saving}
              onClick={() => onEditProjectColor(selectedProject)}
            >
              <i
                style={{
                  background:
                    selectedProject.accentColor ?? DEFAULT_PROJECT_COLOR
                }}
                aria-hidden="true"
              />
              <span>
                <strong>Project colour</strong>
                <small>
                  {selectedProject.accentColor ?? DEFAULT_PROJECT_COLOR}
                </small>
              </span>
            </button>
            <button
              type="button"
              className="fks-project-popout"
              aria-label={`Open ${selectedProject.name} in Dataverse`}
              title="Open project in Dataverse"
              disabled={saving}
              onClick={() => {
                setSubmitError(undefined);
                void onOpenProjectInDataverse(selectedProject.id).catch(
                  (reason) =>
                    setSubmitError(
                      reason instanceof Error
                        ? reason.message
                        : "The Dataverse project could not be opened."
                    )
                );
              }}
            >
              <PopOutIcon />
            </button>
          </div>
        )}
        <SearchSelect
          label="Person"
          placeholder="Search people"
          value={personId}
          required
          invalid={attempted && !personId}
          options={people.map((person) => ({
            id: person.id,
            label: person.name
          }))}
          onChange={setPersonId}
        />
        <label>
          <span>Note <small>(optional)</small></span>
          <input
            value={notes}
            maxLength={100}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="What’s this for?"
          />
        </label>
        <div className="fks-allocation-form__dates">
          <label>
            <span>Start</span>
            <input
              type="date"
              lang="en-GB"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              aria-invalid={attempted && !startDate}
              required
            />
          </label>
          <label>
            <span>End</span>
            <input
              type="date"
              lang="en-GB"
              min={startDate}
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
              aria-invalid={attempted && (!endDate || endDate < startDate)}
              required
            />
          </label>
        </div>
        <label>
          <span>Allocation</span>
          <span className="fks-allocation-hours">
            <input
              type="number"
              min={0.25}
              max={24}
              step={0.25}
              value={hours}
              onChange={(event) => setHours(Number(event.target.value))}
              aria-invalid={attempted && (hours <= 0 || hours > 24)}
              required
            />
            <span className="fks-allocation-hours__unit">Hours/day</span>
          </span>
        </label>
        {recurrenceEditable ? (
          <div className="fks-recurrence-control">
            <div className="fks-recurrence-toggle">
              <span>
                <strong>Repeat allocation</strong>
                <small>{repeating ? "Recurring schedule enabled" : "No recurrence"}</small>
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={repeating}
                aria-label="Repeat allocation"
                onClick={() =>
                  setRecurrencePattern(
                    !repeating
                      ? RECURRENCE_OPTIONS[1].value
                      : RECURRENCE_OPTIONS[0].value
                  )
                }
              >
                <span aria-hidden="true" />
              </button>
            </div>
            {repeating && (
              <div className="fks-allocation-form__dates">
                <label>
                  <span>Pattern</span>
                  <select
                    value={recurrencePattern}
                    onChange={(event) =>
                      setRecurrencePattern(
                        Number(event.target.value) as RecurrencePattern
                      )
                    }
                  >
                    {RECURRENCE_OPTIONS.slice(1).map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Recurrence ends</span>
                  <input
                    type="date"
                    lang="en-GB"
                    min={endDate}
                    value={recurrenceEndDate}
                    onChange={(event) => setRecurrenceEndDate(event.target.value)}
                    aria-invalid={
                      attempted &&
                      (!recurrenceEndDate || recurrenceEndDate < endDate)
                    }
                    required
                  />
                </label>
              </div>
            )}
          </div>
        ) : (
          entry && onOpenSeries && (
            <SeriesLink entry={entry} onOpen={onOpenSeries} />
          )
        )}
        {(submitError || (attempted && validationError)) && (
          <p className="fks-host-form-error" role="alert">
            {submitError ?? validationError}
          </p>
        )}
        <div className="fks-allocation-form__actions">
          {mode === "edit" && onDelete && (
            <button
              type="button"
              className="fks-host-delete-link"
              onClick={() => void onDelete()}
              disabled={saving}
            >
              Delete
            </button>
          )}
          <button type="button" onClick={onCancel} disabled={saving}>Cancel</button>
          <button type="submit" className="fks-host-primary" disabled={saving}>
            {saving
              ? "Saving…"
              : mode === "create"
                ? "Create allocation"
                : "Save changes"}
          </button>
        </div>
      </form>
    </HostDialog>
  );
}

function PopOutIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <path d="M11 4h5v5M16 4l-7 7" />
      <path d="M14 11v4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4" />
    </svg>
  );
}

interface SearchSelectOption {
  id: string;
  label: string;
  description?: string;
  color?: string;
}

function SearchSelect({
  label,
  placeholder,
  value,
  options,
  required,
  invalid,
  onChange
}: {
  label: string;
  placeholder: string;
  value: string;
  options: readonly SearchSelectOption[];
  required?: boolean;
  invalid?: boolean;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = options.find((option) => option.id === value);
  const inputId = `fks-${label.toLocaleLowerCase()}-input`;
  const optionsId = `fks-${label.toLocaleLowerCase()}-options`;
  const normalized = query.trim().toLocaleLowerCase();
  const matches = normalized
    ? options.filter((option) =>
        `${option.label} ${option.description ?? ""}`
          .toLocaleLowerCase()
          .includes(normalized)
      )
    : options;
  return (
    <div
      className="fks-host-combobox"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <label htmlFor={inputId}>{label}{required && <b aria-hidden="true"> *</b>}</label>
      <span className="fks-host-combobox__input">
        {selected?.color && (
          <i style={{ background: selected.color }} aria-hidden="true" />
        )}
        <input
          id={inputId}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={optionsId}
          aria-invalid={invalid}
          value={open ? query : selected?.label ?? ""}
          placeholder={placeholder}
          onFocus={() => {
            setQuery("");
            setOpen(true);
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") setOpen(false);
            if (event.key === "ArrowDown") {
              event.preventDefault();
              event.currentTarget
                .closest(".fks-host-combobox")
                ?.querySelector<HTMLButtonElement>("[role='option']")
                ?.focus();
            }
            if (event.key === "Enter" && open && matches[0]) {
              event.preventDefault();
              onChange(matches[0].id);
              setOpen(false);
            }
          }}
        />
        <span aria-hidden="true">⌄</span>
      </span>
      {open && (
        <span
          id={optionsId}
          className="fks-host-combobox__menu"
          role="listbox"
        >
          {matches.map((option) => (
            <button
              key={option.id}
              type="button"
              role="option"
              aria-selected={option.id === value}
              onClick={() => {
                onChange(option.id);
                setOpen(false);
              }}
            >
              <i
                style={{ background: option.color ?? DEFAULT_PROJECT_COLOR }}
                aria-hidden="true"
              />
              <span>
                <strong>{option.label}</strong>
                {option.description && <small>{option.description}</small>}
              </span>
            </button>
          ))}
          {!matches.length && <small className="fks-host-combobox__empty">No matches found.</small>}
        </span>
      )}
    </div>
  );
}

function allocationInputFromEntry(
  entry: SchedulerEntry<FlowkifyEntryMetadata>
): AllocationCreateInput {
  const recurrencePattern = RECURRENCE_OPTIONS.some(
    (option) => option.value === entry.metadata?.recurrencePattern
  )
    ? (entry.metadata?.recurrencePattern as RecurrencePattern)
    : RECURRENCE_OPTIONS[0].value;
  return {
    projectId: entry.projectId ?? "",
    personId: entry.personId,
    notes: entry.title ?? "",
    startDate: entry.startDate,
    endDate: entry.endDate,
    hoursPerDay: entry.hoursPerDay,
    recurrencePattern,
    ...(entry.metadata?.recurrenceEndDate
      ? { recurrenceEndDate: entry.metadata.recurrenceEndDate }
      : {})
  };
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function formatAllocationRange(startDate: string, endDate: string): string {
  if (!startDate || !endDate) return "Choose allocation dates";
  const format = (value: string) =>
    new Intl.DateTimeFormat("en-GB", {
      weekday: "short",
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: "UTC"
    }).format(new Date(`${value}T00:00:00Z`));
  return startDate === endDate
    ? format(startDate)
    : `${format(startDate)} – ${format(endDate)}`;
}
