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
  type VisibleRange
} from "@flowkify/scheduler";
import "@flowkify/scheduler/styles.css";
import * as React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  DataverseSchedulerRepository,
  type FlowkifyEntryMetadata,
  type LoadedSchedule,
  type MutationScope
} from "./DataverseSchedulerRepository";
import "./host.css";

export interface FlowkifySchedulerHostProps {
  repository: DataverseSchedulerRepository;
  height: number;
  onEntrySelected: (entryId: string) => void;
}

interface ScopePrompt {
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
  onEntrySelected
}: FlowkifySchedulerHostProps): JSX.Element {
  const [schedule, setSchedule] = useState(emptySchedule);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading"
  );
  const [error, setError] = useState<string>();
  const [viewport, setViewport] = useState<SchedulerViewport>({
    zoom: "month",
    anchorDate: todayKey()
  });
  const [filters, setFilters] = useState<SchedulerFilters>({
    query: "",
    personIds: [],
    projectIds: []
  });
  const [scopePrompt, setScopePrompt] = useState<ScopePrompt>();
  const [createPrompt, setCreatePrompt] = useState<CreatePrompt>();
  const [opened, setOpened] =
    useState<SchedulerEntry<FlowkifyEntryMetadata>>();
  const requestGeneration = useRef(0);
  const range = getVisibleRange(viewport);

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
    (
      entry: SchedulerEntry<FlowkifyEntryMetadata>
    ): Promise<MutationScope | "cancel"> => {
      if (!entry.metadata?.seriesId) return Promise.resolve("occurrence");
      return new Promise((resolve) => setScopePrompt({ entry, resolve }));
    },
    []
  );

  const updateEntry = useCallback(
    async (
      mutation:
        | EntryMutation<FlowkifyEntryMetadata>
        | ResizeMutation<FlowkifyEntryMetadata>
    ): Promise<MutationDecision> => {
      const scope = await chooseScope(mutation.entry);
      if (scope === "cancel") return { accepted: false };
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
      const scope = await chooseScope(entry);
      if (scope === "cancel") return { accepted: false };
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
    [chooseScope, range, reload, repository]
  );

  const requestCreate = useCallback(
    (draft: CreateDraft): Promise<MutationDecision> =>
      new Promise((resolve) => setCreatePrompt({ draft, resolve })),
    []
  );

  const closeScope = (choice: MutationScope | "cancel") => {
    scopePrompt?.resolve(choice);
    setScopePrompt(undefined);
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
            <p>{entry.details ?? "Open the entry for Dataverse details."}</p>
            <footer>
              <b>{entry.hoursPerDay}h/day</b>
              {entry.metadata?.seriesId && <span>Recurring</span>}
            </footer>
          </div>
        )}
      />
      {scopePrompt && (
        <HostDialog
          title="Change recurring allocation?"
          onDismiss={() => closeScope("cancel")}
        >
          <p>
            <strong>{scopePrompt.entry.title}</strong> belongs to a recurring
            series. Choose which records Dataverse should change.
          </p>
          <div className="fks-host-dialog__actions fks-host-dialog__actions--stack">
            <button type="button" onClick={() => closeScope("occurrence")}>
              This occurrence
            </button>
            <button
              type="button"
              className="fks-host-primary"
              onClick={() => closeScope("series")}
            >
              Entire series
            </button>
          </div>
        </HostDialog>
      )}
      {createPrompt && (
        <CreateDialog
          draft={createPrompt.draft}
          projects={schedule.projects}
          onCancel={() => {
            createPrompt.resolve({ accepted: false });
            setCreatePrompt(undefined);
          }}
          onSubmit={async (project, hours) => {
            try {
              await repository.create(createPrompt.draft, project, hours);
              await reload(range);
              createPrompt.resolve({ accepted: true });
            } catch (reason) {
              createPrompt.resolve({
                accepted: false,
                reason:
                  reason instanceof Error
                    ? reason.message
                    : "Dataverse rejected the allocation."
              });
            } finally {
              setCreatePrompt(undefined);
            }
          }}
        />
      )}
      {opened && (
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

function HostDialog({
  title,
  onDismiss,
  children
}: {
  title: string;
  onDismiss: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fks-host-backdrop"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onDismiss();
      }}
    >
      <section
        className="fks-host-dialog"
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

function CreateDialog({
  draft,
  projects,
  onCancel,
  onSubmit
}: {
  draft: CreateDraft;
  projects: readonly SchedulerProject[];
  onCancel: () => void;
  onSubmit: (project: SchedulerProject, hours: number) => Promise<void>;
}) {
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [hours, setHours] = useState(8);
  const [saving, setSaving] = useState(false);
  const project = projects.find((candidate) => candidate.id === projectId);
  return (
    <HostDialog title="Create allocation" onDismiss={onCancel}>
      <p className="fks-host-dialog__range">
        {draft.startDate} – {draft.endDate}
      </p>
      <label>
        Project
        <select
          value={projectId}
          onChange={(event) => setProjectId(event.target.value)}
          autoFocus
        >
          {projects.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.name}
              {candidate.customerName ? ` · ${candidate.customerName}` : ""}
            </option>
          ))}
        </select>
      </label>
      <label>
        Hours per day
        <input
          type="number"
          min={0.25}
          max={24}
          step={0.25}
          value={hours}
          onChange={(event) => setHours(Number(event.target.value))}
        />
      </label>
      <div className="fks-host-dialog__actions">
        <button type="button" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button
          type="button"
          className="fks-host-primary"
          disabled={!project || hours <= 0 || saving}
          onClick={async () => {
            if (!project) return;
            setSaving(true);
            await onSubmit(project, hours);
          }}
        >
          {saving ? "Creating…" : "Create allocation"}
        </button>
      </div>
    </HostDialog>
  );
}
