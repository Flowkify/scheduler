import * as React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Scheduler } from "./Scheduler";

const baseProps = {
  people: [{ id: "p1", name: "Ada Lovelace", secondaryText: "Engineer" }],
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
  capacity: [{ personId: "p1", date: "2026-08-03", hours: 8 }],
  viewport: { zoom: "week" as const, anchorDate: "2026-08-03" },
  filters: { query: "", personIds: [], projectIds: [] },
  onViewportChange: vi.fn(),
  onFiltersChange: vi.fn()
};

describe("Scheduler", () => {
  it("renders the controlled toolbar and emits filter changes", () => {
    render(<Scheduler {...baseProps} />);
    const search = screen.getByLabelText("Search people");
    fireEvent.change(search, { target: { value: "Ada" } });
    expect(baseProps.onFiltersChange).toHaveBeenCalledWith({
      query: "Ada",
      personIds: [],
      projectIds: []
    });
    expect(screen.getByRole("button", { name: "Today" })).toBeTruthy();
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
});
