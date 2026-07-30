import {
  addDays,
  daysBetween,
  eachDay,
  intersects,
  isWeekend,
  type CreateDraft,
  type DailyCapacity,
  type EntryMutation,
  type ResizeMutation,
  type SchedulerEntry,
  type SchedulerPerson,
  type SchedulerProject,
  type VisibleRange
} from "@flowkify/scheduler";
import type { IInputs } from "./generated/ManifestTypes";
import { RangeCache } from "./rangeCache";

type DataverseRow = Record<string, unknown>;
export type MutationScope = "occurrence" | "series";

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
const NON_REPEATING = 591210000;

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
        .map((row) => text(row, "flowkify_date"))
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

  public async create(
    draft: CreateDraft,
    project: SchedulerProject,
    hoursPerDay: number
  ): Promise<void> {
    const result = await this.context.webAPI.createRecord("flowkify_allocation", {
      flowkify_name: `${project.name} · ${draft.startDate}`,
      flowkify_startdate: draft.startDate,
      flowkify_enddate: draft.endDate,
      flowkify_hoursperday: hoursPerDay,
      "flowkify_person@odata.bind": `/flowkify_persons(${draft.personId})`,
      "flowkify_projectid@odata.bind": `/flowkify_projects(${project.id})`,
      flowkify_recurrencepattern: NON_REPEATING
    });
    this.allocations.upsert(this.fingerprint, [
      {
        flowkify_allocationid: result.id,
        flowkify_name: `${project.name} · ${draft.startDate}`,
        flowkify_startdate: draft.startDate,
        flowkify_enddate: draft.endDate,
        flowkify_hoursperday: hoursPerDay,
        _flowkify_person_value: draft.personId,
        _flowkify_projectid_value: project.id,
        flowkify_recurrencepattern: NON_REPEATING
      }
    ]);
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

    const rows =
      scope === "series" && metadata.seriesId
        ? await this.loadSeriesRows(metadata.seriesId)
        : [
            {
              flowkify_allocationid: metadata.occurrenceId,
              flowkify_startdate: mutation.previous.startDate,
              flowkify_enddate: mutation.previous.endDate,
              _flowkify_person_value: mutation.previous.personId
            }
          ];
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
        text(row, "flowkify_startdate"),
        startDelta
      ),
      flowkify_enddate: addDays(text(row, "flowkify_enddate"), endDelta),
      _flowkify_person_value: mutation.proposed.personId
    }));

    for (const row of updated) {
      await this.context.webAPI.updateRecord(
        "flowkify_allocation",
        text(row, "flowkify_allocationid"),
        {
          flowkify_startdate: text(row, "flowkify_startdate"),
          flowkify_enddate: text(row, "flowkify_enddate"),
          "flowkify_person@odata.bind": `/flowkify_persons(${mutation.proposed.personId})`
        }
      );
      this.allocations.patch(
        text(row, "flowkify_allocationid"),
        (current) => ({ ...current, ...row })
      );
    }
  }

  public async delete(
    entry: SchedulerEntry<FlowkifyEntryMetadata>,
    scope: MutationScope
  ): Promise<void> {
    const metadata = entry.metadata;
    if (!metadata || metadata.source !== "allocation")
      throw new Error("Only allocations can be deleted.");
    const ids =
      scope === "series" && metadata.seriesId
        ? (await this.loadSeriesRows(metadata.seriesId)).map((row) =>
            text(row, "flowkify_allocationid")
          )
        : [metadata.occurrenceId];
    for (const id of ids)
      await this.context.webAPI.deleteRecord("flowkify_allocation", id);
    this.allocations.remove(ids);
  }

  private async loadStaticData(): Promise<StaticData> {
    const [peopleRows, projectRows] = await Promise.all([
      this.retrieveAll(
        "flowkify_person",
        "?$select=flowkify_personid,flowkify_name,flowkify_firstname,flowkify_lastname,flowkify_jobtitle,flowkify_workhoursperweek,flowkify_startdate,flowkify_enddate&$filter=statecode eq 0&$orderby=flowkify_name asc"
      ),
      this.retrieveAll(
        "flowkify_project",
        "?$select=flowkify_projectid,flowkify_name,flowkify_description,_flowkify_customerid_value,flowkify_stage&$filter=statecode eq 0&$orderby=flowkify_name asc"
      )
    ]);
    return {
      people: peopleRows.map((row) => {
        const name =
          text(row, "flowkify_name") ||
          `${text(row, "flowkify_firstname")} ${text(
            row,
            "flowkify_lastname"
          )}`.trim();
        const employmentEndDate = optionalText(row, "flowkify_enddate");
        return {
          id: text(row, "flowkify_personid"),
          name,
          secondaryText: text(row, "flowkify_jobtitle") || "Team member",
          metadata: {
            weeklyHours: number(row, "flowkify_workhoursperweek"),
            employmentStartDate: text(row, "flowkify_startdate"),
            ...(employmentEndDate ? { employmentEndDate } : {})
          }
        };
      }),
      projects: projectRows.map((row) => {
        const customerName = formatted(row, "_flowkify_customerid_value");
        return {
          id: text(row, "flowkify_projectid"),
          name: text(row, "flowkify_name"),
          ...(customerName ? { customerName } : {}),
          metadata: {
            description: optionalText(row, "flowkify_description"),
            stage: row.flowkify_stage
          }
        };
      })
    };
  }

  private loadAllocations(range: VisibleRange): Promise<DataverseRow[]> {
    return this.retrieveAll(
      "flowkify_allocation",
      `?$select=flowkify_allocationid,flowkify_name,flowkify_startdate,flowkify_enddate,flowkify_hoursperday,_flowkify_person_value,_flowkify_projectid_value,flowkify_recurrencepattern,flowkify_recurrenceenddate,_flowkify_rootallocationid_value&$filter=statecode eq 0 and flowkify_startdate le ${range.endDate} and flowkify_enddate ge ${range.startDate}`
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

function mapAllocation(
  row: DataverseRow
): SchedulerEntry<FlowkifyEntryMetadata> {
  const id = text(row, "flowkify_allocationid");
  const rootAllocationId = optionalText(row, "_flowkify_rootallocationid_value");
  const recurrencePattern = number(row, "flowkify_recurrencepattern");
  const recurring =
    Boolean(rootAllocationId) ||
    (recurrencePattern !== 0 && recurrencePattern !== NON_REPEATING);
  const recurrenceEndDate = optionalText(row, "flowkify_recurrenceenddate");
  return {
    id,
    personId: text(row, "_flowkify_person_value"),
    projectId: text(row, "_flowkify_projectid_value"),
    kind: "allocation",
    startDate: text(row, "flowkify_startdate"),
    endDate: text(row, "flowkify_enddate"),
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
    startDate: text(row, "flowkify_startdate"),
    endDate: text(row, "flowkify_enddate"),
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

function buildAvailableCapacity(
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

function number(row: DataverseRow, key: string): number {
  const value = Number(row[key]);
  return Number.isFinite(value) ? value : 0;
}

function formatted(row: DataverseRow, key: string): string | undefined {
  return optionalText(row, `${key}${FORMATTED}`);
}
