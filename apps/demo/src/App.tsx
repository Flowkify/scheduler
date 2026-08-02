import { useEffect, useMemo, useState } from "react";
import {
  Scheduler,
  todayKey,
  type CreateDraft,
  type EntryMutation,
  type ResizeMutation,
  type SchedulerEntry,
  type SchedulerFilters,
  type SchedulerViewport
} from "@flowkify/scheduler";
import { createDemoData, type DemoMetadata } from "./data";

const wait = (milliseconds: number) =>
  new Promise((resolve) => window.setTimeout(resolve, milliseconds));

export function App(): JSX.Element {
  const today = todayKey();
  const [largeFixture, setLargeFixture] = useState(false);
  const seed = useMemo(
    () => createDemoData(today, largeFixture ? 1000 : 42, largeFixture ? 25000 : 420),
    [largeFixture, today]
  );
  const [entries, setEntries] = useState(seed.entries);
  useEffect(() => {
    setEntries(seed.entries);
  }, [seed]);
  const [viewport, setViewport] = useState<SchedulerViewport>({
    zoom: "week",
    anchorDate: today
  });
  const [filters, setFilters] = useState<SchedulerFilters>({
    query: "",
    personIds: [],
    projectIds: [],
    capacityStatuses: [],
    peopleSort: "name-asc"
  });
  const [showWeekends, setShowWeekends] = useState(false);
  const [opened, setOpened] = useState<SchedulerEntry<DemoMetadata>>();

  const persist = async (
    mutation: EntryMutation<DemoMetadata> | ResizeMutation<DemoMetadata>
  ) => {
    await wait(220);
    setEntries((current) =>
      current.map((entry) =>
        entry.id === mutation.entry.id ? mutation.proposed : entry
      )
    );
    return { accepted: true };
  };

  const create = async (draft: CreateDraft) => {
    await wait(220);
    const project = seed.projects[0];
    setEntries((current) => [
      ...current,
      {
        id: `created-${Date.now()}`,
        personId: draft.personId,
        ...(project ? { projectId: project.id } : {}),
        kind: "allocation",
        startDate: draft.startDate,
        endDate: draft.endDate,
        hoursPerDay: 8,
        title: project?.name ?? "New allocation",
        ...(project?.customerName
          ? { customerName: project.customerName }
          : {}),
        details: "Created by dragging over an empty date range"
      }
    ]);
    return { accepted: true };
  };

  return (
    <main className="demo-shell">
      <header className="demo-heading">
        <div>
          <span>FLOWKIFY</span>
          <h1>People, projects, and capacity—without the noise.</h1>
          <p>
            A date-only planning board that stays calm with 42 people or
            25,000 allocations.
          </p>
        </div>
        <label className="fixture-toggle">
          <input
            type="checkbox"
            checked={largeFixture}
            onChange={(event) => setLargeFixture(event.target.checked)}
          />
          <span>1,000 people / 25k entries</span>
        </label>
      </header>
      <div className="demo-board">
        <Scheduler
          people={seed.people}
          projects={seed.projects}
          entries={entries}
          capacity={seed.capacity}
          viewport={viewport}
          filters={filters}
          showWeekends={showWeekends}
          onViewportChange={setViewport}
          onFiltersChange={setFilters}
          onShowWeekendsChange={setShowWeekends}
          onCreateRequest={create}
          onMoveRequest={persist}
          onResizeRequest={persist}
          onDeleteRequest={async (entry) => {
            await wait(180);
            setEntries((current) =>
              current.filter((candidate) => candidate.id !== entry.id)
            );
            return { accepted: true };
          }}
          onEntryOpen={setOpened}
          renderHoverCard={({ entry, project }) => (
            <div className="demo-hover">
              <span>{project?.customerName ?? "Availability"}</span>
              <strong>{entry.title ?? project?.name}</strong>
              <p>{entry.details ?? "No further details."}</p>
              <footer>
                <span>{entry.hoursPerDay}h per day</span>
                {entry.metadata &&
                  typeof entry.metadata === "object" &&
                  "seriesId" in entry.metadata && <b>Recurring series</b>}
              </footer>
            </div>
          )}
        />
      </div>
      {opened && (
        <div className="demo-modal-backdrop" role="presentation">
          <section className="demo-modal" role="dialog" aria-modal="true">
            <span>{opened.customerName ?? opened.kind}</span>
            <h2>{opened.title ?? "Schedule entry"}</h2>
            <p>{opened.details ?? "No additional details."}</p>
            <dl>
              <div>
                <dt>Dates</dt>
                <dd>
                  {opened.startDate} – {opened.endDate}
                </dd>
              </div>
              <div>
                <dt>Load</dt>
                <dd>{opened.hoursPerDay} hours per day</dd>
              </div>
            </dl>
            <button type="button" onClick={() => setOpened(undefined)}>
              Close
            </button>
          </section>
        </div>
      )}
    </main>
  );
}
