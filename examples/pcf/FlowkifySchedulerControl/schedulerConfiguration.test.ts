import { describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import type { SchedulerEntry, SchedulerPerson } from "@flowkify/scheduler";
import {
  buildAvailableCapacity,
  DataverseSchedulerRepository,
  hasPlanningCapacity,
  mapPerson,
  mapProject,
  normalizeProjectColor,
  validateAllocationCreate,
  type FlowkifyEntryMetadata,
  type FlowkifyPersonMetadata
} from "./DataverseSchedulerRepository";
import { parseDefaultView } from "./configuration";
import {
  applyDefaultZoomChange,
  type FlowkifySchedulerHostProps
} from "./FlowkifySchedulerHost";
import { SchedulerControl } from "./index";

describe("PCF scheduler configuration", () => {
  it("parses the manifest enum and falls back to week", () => {
    expect(parseDefaultView("0")).toBe("day");
    expect(parseDefaultView("1")).toBe("week");
    expect(parseDefaultView("2")).toBe("month");
    expect(parseDefaultView(null)).toBe("week");
    expect(parseDefaultView("unexpected")).toBe("week");
  });

  it("preserves session zoom until the configured default actually changes", () => {
    const monthViewport = { zoom: "month" as const, anchorDate: "2026-07-10" };
    expect(
      applyDefaultZoomChange(monthViewport, "week", "week", "2026-07-31")
    ).toBe(monthViewport);
    expect(
      applyDefaultZoomChange(monthViewport, "week", "day", "2026-07-31")
    ).toEqual({ zoom: "day", anchorDate: "2026-07-31" });
  });

  it("keeps the full Dataverse name but renders the first name", () => {
    const person = mapPerson({
      flowkify_personid: "person-1",
      flowkify_name: "Ada Lovelace",
      flowkify_firstname: "Ada",
      flowkify_lastname: "Lovelace",
      flowkify_workhoursperweek: 40,
      flowkify_startdate: "2026-01-01"
    });
    expect(person.name).toBe("Ada Lovelace");
    expect(person.displayName).toBe("Ada");
    expect(person.secondaryText).toBeUndefined();
  });

  it("maps valid Dataverse project colours and ignores invalid values", () => {
    const project = mapProject({
      flowkify_projectid: "project-1",
      flowkify_name: "Apollo",
      flowkify_color: "#4f6fca",
      "_flowkify_customerid_value@OData.Community.Display.V1.FormattedValue":
        "Northwind"
    });
    expect(project).toMatchObject({
      id: "project-1",
      name: "Apollo",
      customerName: "Northwind",
      accentColor: "#4F6FCA"
    });
    expect(
      mapProject({
        flowkify_projectid: "project-2",
        flowkify_name: "Invalid",
        flowkify_color: "blue"
      }).accentColor
    ).toBeUndefined();
  });

  it("normalizes project colours", () => {
    expect(normalizeProjectColor(" #4f6fca ")).toBe("#4F6FCA");
    expect(normalizeProjectColor("4F6FCA")).toBe("");
  });

  it("excludes active people without weekly planning hours", () => {
    const person = mapPerson({
      flowkify_personid: "person-1",
      flowkify_name: "Ada Lovelace",
      flowkify_workhoursperweek: 0,
      flowkify_startdate: "2026-01-01"
    });
    expect(hasPlanningCapacity(person)).toBe(false);
    expect(
      hasPlanningCapacity({
        ...person,
        metadata: { ...person.metadata!, weeklyHours: 0.25 }
      })
    ).toBe(true);
  });

  it("derives weekday capacity from weekly hours, time off, and holidays", () => {
    const person: SchedulerPerson<FlowkifyPersonMetadata> = {
      id: "person-1",
      name: "Ada Lovelace",
      displayName: "Ada",
      metadata: {
        weeklyHours: 40,
        employmentStartDate: "2026-01-01"
      }
    };
    const absence: SchedulerEntry<FlowkifyEntryMetadata> = {
      id: "timeoff:1",
      personId: person.id,
      kind: "absence",
      startDate: "2026-08-04",
      endDate: "2026-08-04",
      hoursPerDay: 4,
      metadata: { source: "timeoff", occurrenceId: "1" }
    };
    const result = buildAvailableCapacity(
      [person],
      [absence],
      new Set(["2026-08-05"]),
      { startDate: "2026-08-03", endDate: "2026-08-07" }
    );
    expect(result.map((item) => item.hours)).toEqual([8, 4, 0, 8, 8]);
  });

  it("creates allocations with the case-sensitive person navigation property", async () => {
    const createRecord = vi.fn().mockResolvedValue({ id: "allocation-1" });
    const repository = new DataverseSchedulerRepository({
      parameters: { configuration: { raw: null } },
      webAPI: { createRecord }
    } as never);

    await repository.create({
      projectId: "project-1",
      personId: "person-1",
      notes: "Test project Jonas 1",
      startDate: "2026-08-05",
      endDate: "2026-08-05",
      hoursPerDay: 8,
      recurrencePattern: 591210000
    });

    expect(createRecord).toHaveBeenCalledWith(
      "flowkify_allocation",
      expect.objectContaining({
        flowkify_name: "Test project Jonas 1",
        "flowkify_Person@odata.bind": "/flowkify_persons(person-1)",
        "flowkify_projectid@odata.bind": "/flowkify_projects(project-1)",
        flowkify_recurrencepattern: 591210000
      })
    );
  });

  it("updates allocation fields through the same case-sensitive navigation property", async () => {
    const updateRecord = vi.fn().mockResolvedValue({});
    const repository = new DataverseSchedulerRepository({
      parameters: { configuration: { raw: null } },
      webAPI: { updateRecord }
    } as never);
    const entry: SchedulerEntry<FlowkifyEntryMetadata> = {
      id: "allocation-1",
      personId: "person-1",
      projectId: "project-1",
      kind: "allocation",
      title: "Old note",
      startDate: "2026-08-05",
      endDate: "2026-08-05",
      hoursPerDay: 8,
      metadata: {
        source: "allocation",
        occurrenceId: "allocation-1",
        recurrencePattern: 591210000
      }
    };

    await repository.updateAllocation(entry, {
      projectId: "project-2",
      personId: "person-2",
      notes: "Updated note",
      startDate: "2026-08-06",
      endDate: "2026-08-07",
      hoursPerDay: 6,
      recurrencePattern: 591210000
    });

    expect(updateRecord).toHaveBeenCalledWith(
      "flowkify_allocation",
      "allocation-1",
      expect.objectContaining({
        flowkify_name: "Updated note",
        flowkify_startdate: "2026-08-06",
        flowkify_enddate: "2026-08-07",
        flowkify_hoursperday: 6,
        "flowkify_Person@odata.bind": "/flowkify_persons(person-2)",
        "flowkify_projectid@odata.bind": "/flowkify_projects(project-2)"
      })
    );
  });

  it("updates only the project colour in Dataverse", async () => {
    const updateRecord = vi.fn().mockResolvedValue({});
    const repository = new DataverseSchedulerRepository({
      parameters: { configuration: { raw: null } },
      webAPI: { updateRecord }
    } as never);

    await repository.updateProjectColor("project-1", "#4f6fca");

    expect(updateRecord).toHaveBeenCalledWith(
      "flowkify_project",
      "project-1",
      { flowkify_color: "#4F6FCA" }
    );
    await expect(
      repository.updateProjectColor("project-1", "invalid")
    ).rejects.toThrow("Enter a colour in #RRGGBB format.");
    expect(updateRecord).toHaveBeenCalledTimes(1);
  });

  it("opens a project form in a new Dataverse window", async () => {
    const openForm = vi.fn().mockResolvedValue({ savedEntityReference: [] });
    const context = {
      parameters: {
        configuration: { raw: null },
        defaultView: { raw: null },
        height: { raw: null }
      },
      mode: {
        allocatedHeight: 680,
        trackContainerResize: vi.fn()
      },
      navigation: { openForm }
    } as never;
    const control = new SchedulerControl();
    control.init(context, vi.fn());
    const view = control.updateView(context) as ReactElement<
      FlowkifySchedulerHostProps
    >;

    await view.props.onProjectOpenInDataverse("project-1");

    expect(openForm).toHaveBeenCalledWith({
      entityName: "flowkify_project",
      entityId: "project-1",
      openInNewWindow: true
    });
  });

  it("deletes recurring children before the root allocation", async () => {
    const retrieveMultipleRecords = vi.fn().mockResolvedValue({
      entities: [
        { flowkify_allocationid: "root-1" },
        { flowkify_allocationid: "child-1" },
        { flowkify_allocationid: "child-2" }
      ]
    });
    const deleteRecord = vi.fn().mockResolvedValue({});
    const repository = new DataverseSchedulerRepository({
      parameters: { configuration: { raw: null } },
      webAPI: { retrieveMultipleRecords, deleteRecord }
    } as never);
    const entry: SchedulerEntry<FlowkifyEntryMetadata> = {
      id: "root-1",
      personId: "person-1",
      kind: "allocation",
      startDate: "2026-08-03",
      endDate: "2026-08-03",
      hoursPerDay: 8,
      metadata: {
        source: "allocation",
        occurrenceId: "root-1",
        seriesId: "root-1",
        recurrencePattern: 591210001
      }
    };

    await repository.delete(entry, "series");

    expect(deleteRecord.mock.calls.map((call) => call[1])).toEqual([
      "child-1",
      "child-2",
      "root-1"
    ]);
  });

  it("loads the recurring root allocation for the PCF editor", async () => {
    const retrieveRecord = vi.fn().mockResolvedValue({
      flowkify_allocationid: "root-1",
      flowkify_name: "Weekly planning",
      flowkify_startdate: "2026-08-03",
      flowkify_enddate: "2026-08-03",
      flowkify_hoursperday: 8,
      _flowkify_person_value: "person-1",
      _flowkify_projectid_value: "project-1",
      flowkify_recurrencepattern: 591210001,
      flowkify_recurrenceenddate: "2026-09-30"
    });
    const repository = new DataverseSchedulerRepository({
      parameters: { configuration: { raw: null } },
      webAPI: { retrieveRecord }
    } as never);

    const entry = await repository.getAllocation("root-1");

    expect(retrieveRecord).toHaveBeenCalledWith(
      "flowkify_allocation",
      "root-1",
      expect.stringContaining("flowkify_recurrencepattern")
    );
    expect(entry).toMatchObject({
      id: "root-1",
      title: "Weekly planning",
      metadata: { seriesId: "root-1", occurrenceId: "root-1" }
    });
  });

  it("updates a recurring series through its root allocation only", async () => {
    const retrieveMultipleRecords = vi.fn().mockResolvedValue({
      entities: [
        {
          flowkify_allocationid: "root-1",
          flowkify_startdate: "2026-08-03",
          flowkify_enddate: "2026-08-03",
          _flowkify_person_value: "person-1"
        },
        {
          flowkify_allocationid: "child-1",
          flowkify_startdate: "2026-08-10",
          flowkify_enddate: "2026-08-10",
          _flowkify_person_value: "person-1"
        }
      ]
    });
    const updateRecord = vi.fn().mockResolvedValue({});
    const repository = new DataverseSchedulerRepository({
      parameters: { configuration: { raw: null } },
      webAPI: { retrieveMultipleRecords, updateRecord }
    } as never);
    const entry: SchedulerEntry<FlowkifyEntryMetadata> = {
      id: "child-1",
      personId: "person-1",
      kind: "allocation",
      startDate: "2026-08-10",
      endDate: "2026-08-10",
      hoursPerDay: 8,
      metadata: {
        source: "allocation",
        occurrenceId: "child-1",
        rootAllocationId: "root-1",
        seriesId: "root-1"
      }
    };

    await repository.update(
      {
        entry,
        previous: entry,
        proposed: {
          ...entry,
          personId: "person-2",
          startDate: "2026-08-11",
          endDate: "2026-08-11"
        }
      },
      "series"
    );

    expect(updateRecord).toHaveBeenCalledTimes(1);
    expect(updateRecord).toHaveBeenCalledWith(
      "flowkify_allocation",
      "root-1",
      expect.objectContaining({
        flowkify_startdate: "2026-08-04",
        flowkify_enddate: "2026-08-04",
        "flowkify_Person@odata.bind": "/flowkify_persons(person-2)"
      })
    );
  });

  it("requires valid dates and a recurrence boundary", () => {
    const input = {
      projectId: "project-1",
      personId: "person-1",
      notes: "Delivery support",
      startDate: "2026-08-05",
      endDate: "2026-08-06",
      hoursPerDay: 8,
      recurrencePattern: 591210001 as const
    };
    expect(validateAllocationCreate(input)).toBe(
      "Recurrence must end on or after the allocation end date."
    );
    expect(
      validateAllocationCreate({ ...input, recurrenceEndDate: "2026-09-30" })
    ).toBeUndefined();
    expect(
      validateAllocationCreate({
        ...input,
        notes: "",
        recurrenceEndDate: "2026-09-30"
      })
    ).toBeUndefined();
  });
});
