import {
  addDays,
  daysBetween,
  eachDay,
  intersects,
  isWeekend,
  type DailyCapacity,
  type EntryMutation,
  type ResizeMutation,
  type SchedulerEntry,
  type SchedulerPerson,
  type SchedulerProject,
  type VisibleRange
} from "@flowkify/scheduler";
import type { IInputs } from "./generated/ManifestTypes";
import { normalizeDataverseId } from "./configuration";
import { RangeCache } from "./rangeCache";

type DataverseRow = Record<string, unknown>;
export type MutationScope = "occurrence" | "series";

export const RECURRENCE_OPTIONS = [
  { value: 591210000, label: "Non-repeating" },
  { value: 591210001, label: "Every week" },
  { value: 591210002, label: "Every two weeks" },
  { value: 591210003, label: "Every month" }
] as const;

export type RecurrencePattern = (typeof RECURRENCE_OPTIONS)[number]["value"];

export const DEFAULT_PROJECT_COLOR = "#5A67D8";

export interface AllocationCreateInput {
  projectId: string;
  personId: string;
  notes: string;
  startDate: string;
  endDate: string;
  hoursPerDay: number;
  recurrencePattern: RecurrencePattern;
  recurrenceEndDate?: string;
}

export interface FlowkifyEntryMetadata {
  source: "allocation" | "timeoff";
  occurrenceId: string;
  seriesId?: string;
  rootAllocationId?: string;
  recurrencePattern?: number;
  recurrenceEndDate?: string;
}

export interface FlowkifyPersonMetadata {
  weeklyHours: number;
  employmentStartDate: string;
  employmentEndDate?: string;
}

export interface LoadedSchedule {
  people: SchedulerPerson<FlowkifyPersonMetadata>[];
  projects: SchedulerProject[];
  entries: SchedulerEntry<FlowkifyEntryMetadata>[];
  capacity: DailyCapacity[];
}

interface StaticData {
  people: SchedulerPerson<FlowkifyPersonMetadata>[];
  projects: SchedulerProject[];
}

const FORMATTED = "@OData.Community.Display.V1.FormattedValue";
const NON_REPEATING = RECURRENCE_OPTIONS[0].value;
const PERSON_BIND = "flowkify_Person@odata.bind";
const ALLOCATION_COLUMNS =
  "flowkify_allocationid,flowkify_name,flowkify_startdate,flowkify_enddate,flowkify_hoursperday,_flowkify_person_value,_flowkify_projectid_value,flowkify_recurrencepattern,flowkify_recurrenceenddate,_flowkify_rootallocationid_value";

export class DataverseSchedulerRepository {
  private context: ComponentFramework.Context<IInputs>;
  private fingerprint = "flowkify-v1";
  private staticData?: Promise<StaticData>;
  private readonly allocations = new RangeCache<DataverseRow>((row) =>
    text(row, "flowkify_allocationid")
  );
  private readonly timeOff = new RangeCache<DataverseRow>((row) =>
    text(row, "flowkify_timeoffid")
  );
  private readonly holidays = new RangeCache<DataverseRow>((row) =>
    text(row, "flowkify_publicholidayid")
  );

  public constructor(context: ComponentFramework.Context<IInputs>) {
    this.context = context;
    this.setContext(context);
  }

  public setContext(context: ComponentFramework.Context<IInputs>): void {
    this.context = context;
    const next = context.parameters.configuration.raw?.trim() || "flowkify-v1";
    if (next !== this.fingerprint) {
      this.fingerprint = next;
      this.staticData = undefined;
      this.allocations.invalidate();
      this.timeOff.invalidate();
      this.holidays.invalidate();
    }
  }

  public async load(range: VisibleRange): Promise<LoadedSchedule> {
    const staticDataPromise = (this.staticData ??= this.loadStaticData());
    const bufferDays = daysBetween(range.startDate, range.endDate) + 1;
    const buffered = {
      startDate: addDays(range.startDate, -bufferDays),
      endDate: addDays(range.endDate, bufferDays)
    };
    let loaded: [StaticData, DataverseRow[], DataverseRow[], DataverseRow[]];
    try {
      loaded = await Promise.all([
        staticDataPromise,
        this.allocations.load(this.fingerprint, buffered, (missing) =>
          this.loadAllocations(missing)
        ),
        this.timeOff.load(this.fingerprint, buffered, (missing) =>
          this.loadTimeOff(missing)
        ),
        this.holidays.load(this.fingerprint, buffered, (missing) =>
          this.loadHolidays(missing)
        )
      ]);
    } catch (error) {
      if (this.staticData === staticDataPromise) this.staticData = undefined;
      throw error;
    }
    const [staticData, allocationRows, timeOffRows, holidayRows] = loaded;

    const allocations = allocationRows
      .map(mapAllocation)
      .filter((entry) => intersects(entry.startDate, entry.endDate, range));
    const absences = timeOffRows
      .map(mapTimeOff)
      .filter((entry) => intersects(entry.startDate, entry.endDate, range));
    const holidayDates = new Set(
      holidayRows
        .map((row) => date(row, "flowkify_date"))
        .filter((date) => date >= range.startDate && date <= range.endDate)
    );
    return {
      ...staticData,
      entries: [...allocations, ...absences],
      capacity: buildAvailableCapacity(
        staticData.people,
        absences,
        holidayDates,
        range
      )
    };
  }

  public async loadProjectDefaults(projectNumber: string) {
    const escapedProjectNumber = projectNumber.replace(/'/g, "''");
    const [project] = await this.retrieveAll(
      "flowkify_project",
      `?$select=flowkify_projectid&$filter=flowkify_projectno eq '${escapedProjectNumber}'&$top=1`
    );
    const projectId = project
      ? normalizeDataverseId(optionalText(project, "flowkify_projectid"))
      : undefined;
    if (!projectId) return { projectId, personIds: [] };
    const people = await this.retrieveAll(
      "flowkify_projectperson",
      `?$select=_flowkify_personid_value&$filter=statecode eq 0 and _flowkify_projectid_value eq ${projectId}`
    );
    const personIds = people
      .map((row) =>
        normalizeDataverseId(optionalText(row, "_flowkify_personid_value"))
      )
      .filter((id): id is string => Boolean(id));
    return { projectId, personIds: [...new Set(personIds)] };
  }

  public async create(input: AllocationCreateInput): Promise<void> {
    const validationError = validateAllocationCreate(input);
    if (validationError) throw new Error(validationError);
    const notes = input.notes.trim() || `Allocation · ${input.startDate}`;
    const result = await this.context.webAPI.createRecord("flowkify_allocation", {
      flowkify_name: notes,
      flowkify_startdate: input.startDate,
      flowkify_enddate: input.endDate,
      flowkify_hoursperday: input.hoursPerDay,
      [PERSON_BIND]: `/flowkify_persons(${input.personId})`,
      "flowkify_projectid@odata.bind": `/flowkify_projects(${input.projectId})`,
      flowkify_recurrencepattern: input.recurrencePattern,
      ...(input.recurrenceEndDate
        ? { flowkify_recurrenceenddate: input.recurrenceEndDate }
        : {})
    });
    if (input.recurrencePattern !== NON_REPEATING) {
      this.allocations.invalidate();
      return;
    }
    this.allocations.upsert(this.fingerprint, [
      {
        flowkify_allocationid: result.id,
        flowkify_name: notes,
        flowkify_startdate: input.startDate,
        flowkify_enddate: input.endDate,
        flowkify_hoursperday: input.hoursPerDay,
        _flowkify_person_value: input.personId,
        _flowkify_projectid_value: input.projectId,
        flowkify_recurrencepattern: input.recurrencePattern
      }
    ]);
  }

  public async updateAllocation(
    entry: SchedulerEntry<FlowkifyEntryMetadata>,
    input: AllocationCreateInput
  ): Promise<void> {
    const validationError = validateAllocationCreate(input);
    if (validationError) throw new Error(validationError);
    const metadata = entry.metadata;
    if (!metadata || metadata.source !== "allocation")
      throw new Error("Only allocations can be edited.");
    const controlsSeries = !metadata.rootAllocationId;
    const notes = input.notes.trim() || `Allocation · ${input.startDate}`;
    const payload = {
      flowkify_name: notes,
      flowkify_startdate: input.startDate,
      flowkify_enddate: input.endDate,
      flowkify_hoursperday: input.hoursPerDay,
      [PERSON_BIND]: `/flowkify_persons(${input.personId})`,
      "flowkify_projectid@odata.bind": `/flowkify_projects(${input.projectId})`,
      ...(controlsSeries
        ? {
            flowkify_recurrencepattern: input.recurrencePattern,
            flowkify_recurrenceenddate:
              input.recurrencePattern === NON_REPEATING
                ? null
                : input.recurrenceEndDate
          }
        : {})
    };
    await this.context.webAPI.updateRecord(
      "flowkify_allocation",
      metadata.occurrenceId,
      payload
    );
    if (controlsSeries && (metadata.seriesId || input.recurrencePattern !== NON_REPEATING)) {
      this.allocations.invalidate();
      return;
    }
    this.allocations.patch(metadata.occurrenceId, (current) => ({
      ...current,
      flowkify_name: notes,
      flowkify_startdate: input.startDate,
      flowkify_enddate: input.endDate,
      flowkify_hoursperday: input.hoursPerDay,
      _flowkify_person_value: input.personId,
      _flowkify_projectid_value: input.projectId,
      ...(controlsSeries
        ? {
            flowkify_recurrencepattern: input.recurrencePattern,
            flowkify_recurrenceenddate: input.recurrenceEndDate
          }
        : {})
    }));
  }

  public async updateProjectColor(
    projectId: string,
    color: string
  ): Promise<void> {
    if (!projectId) throw new Error("Choose a project.");
    const normalized = normalizeProjectColor(color);
    if (!normalized) throw new Error("Enter a colour in #RRGGBB format.");
    await this.context.webAPI.updateRecord("flowkify_project", projectId, {
      flowkify_color: normalized
    });
    this.staticData = undefined;
  }

  public async getAllocation(
    id: string
  ): Promise<SchedulerEntry<FlowkifyEntryMetadata>> {
    const row = await this.context.webAPI.retrieveRecord(
      "flowkify_allocation",
      id,
      `?$select=${ALLOCATION_COLUMNS}`
    );
    return mapAllocation(row as DataverseRow);
  }

  public async update(
    mutation:
      | EntryMutation<FlowkifyEntryMetadata>
      | ResizeMutation<FlowkifyEntryMetadata>,
    scope: MutationScope
  ): Promise<void> {
    const metadata = mutation.entry.metadata;
    if (!metadata || metadata.source !== "allocation")
      throw new Error("Only allocations can be moved or resized.");

    const seriesId = scope === "series" ? metadata.seriesId : undefined;
    const rows = seriesId
      ? (await this.loadSeriesRows(seriesId)).filter(
          (row) => text(row, "flowkify_allocationid") === seriesId
        )
      : [
          {
            flowkify_allocationid: metadata.occurrenceId,
            flowkify_startdate: mutation.previous.startDate,
            flowkify_enddate: mutation.previous.endDate,
            _flowkify_person_value: mutation.previous.personId
          }
        ];
    if (!rows.length) throw new Error("The root allocation could not be found.");
    const startDelta = daysBetween(
      mutation.previous.startDate,
      mutation.proposed.startDate
    );
    const endDelta = daysBetween(
      mutation.previous.endDate,
      mutation.proposed.endDate
    );
    const updated = rows.map((row) => ({
      ...row,
      flowkify_startdate: addDays(
        date(row, "flowkify_startdate"),
        startDelta
      ),
      flowkify_enddate: addDays(date(row, "flowkify_enddate"), endDelta),
      _flowkify_person_value: mutation.proposed.personId
    }));

    for (const row of updated) {
      await this.context.webAPI.updateRecord(
        "flowkify_allocation",
        text(row, "flowkify_allocationid"),
        {
          flowkify_startdate: text(row, "flowkify_startdate"),
          flowkify_enddate: text(row, "flowkify_enddate"),
          [PERSON_BIND]: `/flowkify_persons(${mutation.proposed.personId})`
        }
      );
      if (!seriesId)
        this.allocations.patch(
          text(row, "flowkify_allocationid"),
          (current) => ({ ...current, ...row })
        );
    }
    if (seriesId) this.allocations.invalidate();
  }

  public async delete(
    entry: SchedulerEntry<FlowkifyEntryMetadata>,
    scope: MutationScope
  ): Promise<void> {
    const metadata = entry.metadata;
    if (!metadata || metadata.source !== "allocation")
      throw new Error("Only allocations can be deleted.");
    let ids =
      scope === "series" && metadata.seriesId
        ? (await this.loadSeriesRows(metadata.seriesId)).map((row) =>
            text(row, "flowkify_allocationid")
          )
        : [metadata.occurrenceId];
    if (scope === "series" && metadata.seriesId) {
      const rootId = metadata.seriesId;
      ids = ids.filter((id) => id !== rootId);
      ids.push(rootId);
    }
    for (const id of ids)
      await this.context.webAPI.deleteRecord("flowkify_allocation", id);
    if (scope === "series") this.allocations.invalidate();
    else this.allocations.remove(ids);
  }

  private async loadStaticData(): Promise<StaticData> {
    const [peopleRows, projectRows] = await Promise.all([
      this.retrieveAll(
        "flowkify_person",
        "?$select=flowkify_personid,flowkify_name,flowkify_firstname,flowkify_lastname,flowkify_jobtitle,flowkify_workhoursperweek,flowkify_startdate,flowkify_enddate&$filter=statecode eq 0&$orderby=flowkify_name asc"
      ),
      this.retrieveAll(
        "flowkify_project",
        "?$select=flowkify_projectid,flowkify_name,flowkify_description,_flowkify_customerid_value,flowkify_stage,flowkify_color&$filter=statecode eq 0&$orderby=flowkify_name asc"
      )
    ]);
    return {
      people: peopleRows.map(mapPerson).filter(hasPlanningCapacity),
      projects: projectRows.map(mapProject)
    };
  }

  private loadAllocations(range: VisibleRange): Promise<DataverseRow[]> {
    return this.retrieveAll(
      "flowkify_allocation",
      `?$select=${ALLOCATION_COLUMNS}&$filter=statecode eq 0 and flowkify_startdate le ${range.endDate} and flowkify_enddate ge ${range.startDate}`
    );
  }

  private loadTimeOff(range: VisibleRange): Promise<DataverseRow[]> {
    return this.retrieveAll(
      "flowkify_timeoff",
      `?$select=flowkify_timeoffid,flowkify_name,flowkify_startdate,flowkify_enddate,flowkify_hoursperday,_flowkify_personid_value,_flowkify_timeofftypeid_value&$filter=statecode eq 0 and flowkify_startdate le ${range.endDate} and flowkify_enddate ge ${range.startDate}`
    );
  }

  private loadHolidays(range: VisibleRange): Promise<DataverseRow[]> {
    return this.retrieveAll(
      "flowkify_publicholiday",
      `?$select=flowkify_publicholidayid,flowkify_name,flowkify_date&$filter=statecode eq 0 and flowkify_date ge ${range.startDate} and flowkify_date le ${range.endDate}`
    );
  }

  private loadSeriesRows(seriesId: string): Promise<DataverseRow[]> {
    return this.retrieveAll(
      "flowkify_allocation",
      `?$select=flowkify_allocationid,flowkify_startdate,flowkify_enddate,_flowkify_person_value&$filter=statecode eq 0 and (flowkify_allocationid eq ${seriesId} or _flowkify_rootallocationid_value eq ${seriesId})`
    );
  }

  private async retrieveAll(
    entityName: string,
    initialOptions: string
  ): Promise<DataverseRow[]> {
    const rows: DataverseRow[] = [];
    let options: string | undefined = initialOptions;
    while (options) {
      const result: ComponentFramework.WebApi.RetrieveMultipleResponse =
        await this.context.webAPI.retrieveMultipleRecords(
        entityName,
        options,
        5000
      );
      rows.push(...(result.entities as DataverseRow[]));
      if (!result.nextLink) break;
      const queryIndex = result.nextLink.indexOf("?");
      options =
        queryIndex >= 0 ? result.nextLink.slice(queryIndex) : result.nextLink;
    }
    return rows;
  }
}

export function validateAllocationCreate(
  input: AllocationCreateInput
): string | undefined {
  if (!input.projectId) return "Choose a project.";
  if (!input.personId) return "Choose a person.";
  if (input.notes.trim().length > 100)
    return "Notes cannot exceed 100 characters.";
  if (!input.startDate || !input.endDate) return "Enter a start and end date.";
  if (input.endDate < input.startDate)
    return "End date must be on or after the start date.";
  if (!Number.isFinite(input.hoursPerDay) || input.hoursPerDay <= 0)
    return "Hours per day must be greater than zero.";
  if (input.hoursPerDay > 24) return "Hours per day cannot exceed 24.";
  if (
    input.recurrencePattern !== NON_REPEATING &&
    (!input.recurrenceEndDate || input.recurrenceEndDate < input.endDate)
  )
    return "Recurrence must end on or after the allocation end date.";
  return undefined;
}

export function normalizeProjectColor(color: string): string {
  const normalized = color.trim().toUpperCase();
  return /^#[0-9A-F]{6}$/.test(normalized) ? normalized : "";
}

export function mapProject(row: DataverseRow): SchedulerProject {
  const customerName = formatted(row, "_flowkify_customerid_value");
  const accentColor = normalizeProjectColor(text(row, "flowkify_color"));
  return {
    id: text(row, "flowkify_projectid"),
    name: text(row, "flowkify_name"),
    ...(customerName ? { customerName } : {}),
    ...(accentColor ? { accentColor } : {}),
    metadata: {
      description: optionalText(row, "flowkify_description"),
      stage: row.flowkify_stage
    }
  };
}

function mapAllocation(
  row: DataverseRow
): SchedulerEntry<FlowkifyEntryMetadata> {
  const id = text(row, "flowkify_allocationid");
  const rootAllocationId = optionalText(row, "_flowkify_rootallocationid_value");
  const recurrencePattern = number(row, "flowkify_recurrencepattern");
  const recurring =
    Boolean(rootAllocationId) ||
    (recurrencePattern !== 0 && recurrencePattern !== NON_REPEATING);
  const recurrenceEndDate =
    date(row, "flowkify_recurrenceenddate") || undefined;
  return {
    id,
    personId: text(row, "_flowkify_person_value"),
    projectId: text(row, "_flowkify_projectid_value"),
    kind: "allocation",
    startDate: date(row, "flowkify_startdate"),
    endDate: date(row, "flowkify_enddate"),
    hoursPerDay: number(row, "flowkify_hoursperday"),
    title: text(row, "flowkify_name"),
    metadata: {
      source: "allocation",
      occurrenceId: id,
      recurrencePattern,
      ...(recurrenceEndDate ? { recurrenceEndDate } : {}),
      ...(rootAllocationId ? { rootAllocationId } : {}),
      ...(recurring ? { seriesId: rootAllocationId || id } : {})
    }
  };
}

function mapTimeOff(
  row: DataverseRow
): SchedulerEntry<FlowkifyEntryMetadata> {
  const id = text(row, "flowkify_timeoffid");
  return {
    id: `timeoff:${id}`,
    personId: text(row, "_flowkify_personid_value"),
    kind: "absence",
    startDate: date(row, "flowkify_startdate"),
    endDate: date(row, "flowkify_enddate"),
    hoursPerDay: number(row, "flowkify_hoursperday"),
    title:
      formatted(row, "_flowkify_timeofftypeid_value") ||
      text(row, "flowkify_name") ||
      "Time off",
    readOnly: true,
    appearance: { variant: "striped" },
    metadata: { source: "timeoff", occurrenceId: id }
  };
}

export function mapPerson(
  row: DataverseRow
): SchedulerPerson<FlowkifyPersonMetadata> {
  const fullName =
    text(row, "flowkify_name") ||
    `${text(row, "flowkify_firstname")} ${text(
      row,
      "flowkify_lastname"
    )}`.trim();
  const displayName =
    text(row, "flowkify_firstname").trim() ||
    fullName.trim().split(/\s+/)[0] ||
    "Unnamed";
  const employmentEndDate = date(row, "flowkify_enddate") || undefined;
  return {
    id: text(row, "flowkify_personid"),
    name: fullName || displayName,
    displayName,
    metadata: {
      weeklyHours: number(row, "flowkify_workhoursperweek"),
      employmentStartDate: date(row, "flowkify_startdate"),
      ...(employmentEndDate ? { employmentEndDate } : {})
    }
  };
}

export function hasPlanningCapacity(
  person: SchedulerPerson<FlowkifyPersonMetadata>
): boolean {
  return (person.metadata?.weeklyHours ?? 0) > 0;
}

export function buildAvailableCapacity(
  people: readonly SchedulerPerson<FlowkifyPersonMetadata>[],
  absences: readonly SchedulerEntry<FlowkifyEntryMetadata>[],
  holidays: ReadonlySet<string>,
  range: VisibleRange
): DailyCapacity[] {
  const absenceHours = new Map<string, number>();
  for (const absence of absences)
    for (const date of eachDay({
      startDate:
        absence.startDate < range.startDate ? range.startDate : absence.startDate,
      endDate: absence.endDate > range.endDate ? range.endDate : absence.endDate
    })) {
      const key = `${absence.personId}:${date}`;
      absenceHours.set(key, (absenceHours.get(key) ?? 0) + absence.hoursPerDay);
    }

  return people.flatMap((person) =>
    eachDay(range).map((date) => {
      const metadata = person.metadata;
      if (!metadata) return { personId: person.id, date, hours: 0 };
      const employed =
        date >= metadata.employmentStartDate &&
        (!metadata.employmentEndDate || date <= metadata.employmentEndDate);
      const base =
        employed && !isWeekend(date) && !holidays.has(date)
          ? metadata.weeklyHours / 5
          : 0;
      return {
        personId: person.id,
        date,
        hours: Math.max(0, base - (absenceHours.get(`${person.id}:${date}`) ?? 0))
      };
    })
  );
}

function text(row: DataverseRow, key: string): string {
  const value = row[key];
  return value === null || value === undefined ? "" : String(value);
}

function optionalText(row: DataverseRow, key: string): string | undefined {
  return text(row, key) || undefined;
}

function date(row: DataverseRow, key: string): string {
  return text(row, key).slice(0, 10);
}

function number(row: DataverseRow, key: string): number {
  const value = Number(row[key]);
  return Number.isFinite(value) ? value : 0;
}

function formatted(row: DataverseRow, key: string): string | undefined {
  return optionalText(row, `${key}${FORMATTED}`);
}
