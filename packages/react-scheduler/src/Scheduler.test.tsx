import * as React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTimelineRange, Scheduler } from "./Scheduler";

const baseProps = {
  people: [
    {
      id: "p1",
      name: "Ada Lovelace",
      displayName: "Ada",
      secondaryText: "Engineer"
    }
  ],
  projects: [{ id: "pr1", name: "Apollo", customerName: "Northwind" }],
  entries: [
    {
      id: "e1",
      personId: "p1",
      projectId: "pr1",
      kind: "allocation",
      startDate: "2026-08-03",
      endDate: "2026-08-05",
      hoursPerDay: 6
    }
  ],
  capacity: ["2026-08-03", "2026-08-04", "2026-08-05"].map((date) => ({
    personId: "p1",
    date,
    hours: 8
  })),
  viewport: { zoom: "week" as const, anchorDate: "2026-08-03" },
  filters: { query: "", personIds: [], projectIds: [] },
  onViewportChange: vi.fn(),
  onFiltersChange: vi.fn()
};

describe("Scheduler", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  beforeEach(() => {
    baseProps.onFiltersChange.mockClear();
    baseProps.onViewportChange.mockClear();
  });

  it("renders the controlled toolbar and emits filter changes", () => {
    render(<Scheduler {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    const search = screen.getByLabelText("Search people");
    fireEvent.change(search, { target: { value: "Ada" } });
    fireEvent.click(screen.getByLabelText("Ada Lovelace"));
    expect(baseProps.onFiltersChange).toHaveBeenCalledWith({
      query: "",
      personIds: ["p1"],
      projectIds: []
    });
    expect(screen.getByRole("button", { name: "Today" })).toBeTruthy();
    expect(screen.getByText("Ada")).toBeTruthy();
    expect(screen.getByLabelText("75% capacity for Ada Lovelace")).toBeTruthy();
    expect(screen.getByText("Ada Lovelace")).toBeTruthy();
  });

  it("searches projects by project and company name", () => {
    render(<Scheduler {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    fireEvent.click(screen.getByRole("tab", { name: "Projects" }));
    fireEvent.change(screen.getByLabelText("Search projects or companies"), {
      target: { value: "northwind" }
    });
    expect(screen.getByLabelText("Apollo · Northwind")).toBeTruthy();
  });

  it("renders loading and error states", () => {
    const { rerender } = render(<Scheduler {...baseProps} status="loading" />);
    expect(screen.getByText("Loading schedule…")).toBeTruthy();
    rerender(
      <Scheduler
        {...baseProps}
        status="error"
        errorMessage="Dataverse unavailable"
      />
    );
    expect(screen.getByRole("alert").textContent).toContain(
      "Dataverse unavailable"
    );
  });

  it("shows three lanes and expands a person inline to all allocations", () => {
    const entries = Array.from({ length: 4 }, (_, index) => ({
      ...baseProps.entries[0]!,
      id: `e${index + 1}`,
      startDate: "2026-08-03",
      endDate: "2026-08-05"
    }));
    render(<Scheduler {...baseProps} entries={entries} />);
    expect(document.querySelectorAll("[data-entry-id]")).toHaveLength(3);
    const row = document.querySelector<HTMLElement>(".fks-row");
    const collapsedHeight = row?.style.height;
    fireEvent.click(
      screen.getByRole("button", { name: "Expand allocations for Ada Lovelace" })
    );
    expect(document.querySelectorAll("[data-entry-id]")).toHaveLength(4);
    expect(row?.style.height).not.toBe(collapsedHeight);
    expect(
      screen
        .getByRole("button", { name: "Collapse allocations for Ada Lovelace" })
        .getAttribute("aria-expanded")
    ).toBe("true");
  });

  it("emits capacity filters and capacity sorting", () => {
    render(<Scheduler {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    fireEvent.click(screen.getByRole("tab", { name: "Capacity" }));
    fireEvent.click(screen.getByLabelText("Under capacity"));
    expect(baseProps.onFiltersChange).toHaveBeenLastCalledWith({
      ...baseProps.filters,
      capacityStatuses: ["under"]
    });

    fireEvent.click(screen.getByRole("tab", { name: "Sort" }));
    fireEvent.click(screen.getByLabelText("Capacity high to low"));
    expect(baseProps.onFiltersChange).toHaveBeenLastCalledWith({
      ...baseProps.filters,
      peopleSort: "capacity-desc"
    });
  });

  it("opens an allocation on a pointer click without issuing a move", () => {
    const onEntryOpen = vi.fn();
    const onMoveRequest = vi.fn().mockResolvedValue({ accepted: true });
    render(
      <Scheduler
        {...baseProps}
        onEntryOpen={onEntryOpen}
        onMoveRequest={onMoveRequest}
      />
    );
    const entry = screen.getByRole("button", { name: /Apollo/ });
    fireEvent.pointerDown(entry, { button: 0, clientX: 300, clientY: 140 });
    fireEvent.pointerUp(window, { clientX: 300, clientY: 140 });
    expect(onEntryOpen).toHaveBeenCalledWith(baseProps.entries[0]);
    expect(onMoveRequest).not.toHaveBeenCalled();
  });

  it("shows allocation actions on right-click", async () => {
    const onEntryOpen = vi.fn();
    const onDeleteRequest = vi.fn().mockResolvedValue({ accepted: true });
    render(
      <div data-testid="embedded-host" style={{ transform: "translate(80px, 50px)" }}>
        <Scheduler
          {...baseProps}
          onEntryOpen={onEntryOpen}
          onDeleteRequest={onDeleteRequest}
        />
      </div>
    );
    const host = screen.getByTestId("embedded-host");
    Object.defineProperties(host, {
      offsetWidth: { value: 1_000 },
      offsetHeight: { value: 600 }
    });
    host.getBoundingClientRect = () => new DOMRect(80, 50, 1_000, 600);
    const entry = screen.getByRole("button", { name: /Apollo/ });
    fireEvent.contextMenu(entry, { clientX: 410, clientY: 180 });
    const menu = screen.getByRole("menu");
    expect(menu.closest(".fks-root")).toBeTruthy();
    expect(menu.style.left).toBe("330px");
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit allocation" }));
    expect(onEntryOpen).toHaveBeenCalledWith(baseProps.entries[0]);

    fireEvent.contextMenu(entry, { clientX: 410, clientY: 180 });
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete allocation" }));
    await waitFor(() => expect(onDeleteRequest).toHaveBeenCalledWith(baseProps.entries[0]));
  });

  it("dismisses the hover card when the pointer leaves the allocation", async () => {
    render(<Scheduler {...baseProps} />);
    const entry = screen.getByRole("button", { name: /Apollo/ });
    fireEvent.mouseEnter(entry, { clientX: 410, clientY: 180 });
    await waitFor(() => expect(screen.getByRole("tooltip")).toBeTruthy());
    expect(screen.getByRole("tooltip").closest(".fks-root")).toBeTruthy();
    expect(screen.getByRole("tooltip").style.left).toBe("410px");
    fireEvent.mouseLeave(entry);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("hides weekends in week view and exposes a session setting", () => {
    const onShowWeekendsChange = vi.fn();
    const { rerender } = render(
      <Scheduler
        {...baseProps}
        showWeekends={false}
        onShowWeekendsChange={onShowWeekendsChange}
      />
    );
    expect(screen.getByRole("grid").getAttribute("aria-colcount")).toBe("5");
    fireEvent.click(screen.getByRole("button", { name: "View" }));
    fireEvent.click(screen.getByLabelText("Show weekends"));
    expect(onShowWeekendsChange).toHaveBeenCalledWith(true);

    rerender(
      <Scheduler
        {...baseProps}
        showWeekends
        onShowWeekendsChange={onShowWeekendsChange}
      />
    );
    expect(screen.getByRole("grid").getAttribute("aria-colcount")).toBe("7");
  });

  it("only removes weekends from the week timeline", () => {
    const range = { startDate: "2026-08-02", endDate: "2026-08-08" };
    expect(getTimelineRange(range, "week", false)).toEqual({
      startDate: "2026-08-03",
      endDate: "2026-08-07"
    });
    expect(getTimelineRange(range, "month", false)).toBe(range);
    expect(getTimelineRange(range, "day", false)).toBe(range);
  });

  it("shows success toasts and suppresses silent cancellations", async () => {
    const onDeleteRequest = vi.fn().mockResolvedValue({ accepted: true });
    const { unmount } = render(
      <Scheduler {...baseProps} onDeleteRequest={onDeleteRequest} />
    );
    fireEvent.keyDown(screen.getByRole("button", { name: /Apollo/ }), {
      key: "Delete"
    });
    await waitFor(() =>
      expect(screen.getByText("Allocation deleted.")).toBeTruthy()
    );
    unmount();

    const silentDelete = vi
      .fn()
      .mockResolvedValue({ accepted: false, silent: true });
    render(
      <Scheduler
        {...baseProps}
        onDeleteRequest={silentDelete}
      />
    );
    fireEvent.keyDown(screen.getByRole("button", { name: /Apollo/ }), {
      key: "Delete"
    });
    await waitFor(() => expect(silentDelete).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
