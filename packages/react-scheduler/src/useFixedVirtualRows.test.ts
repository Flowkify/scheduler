import { describe, expect, it } from "vitest";
import { calculateVariableRows } from "./useFixedVirtualRows";

describe("variable row virtualization", () => {
  it("calculates mixed offsets and renders only the visible window", () => {
    const result = calculateVariableRows(
      [68, 108, 68, 148, 68],
      170,
      100,
      48,
      0,
      (index) => `person-${index}`
    );
    expect(result.totalSize).toBe(460);
    expect(result.rows).toEqual([
      { index: 1, key: "person-1", start: 68, size: 108 },
      { index: 2, key: "person-2", start: 176, size: 68 }
    ]);
  });

  it("adds overscan without losing variable starts", () => {
    const result = calculateVariableRows(
      [68, 108, 68, 148],
      224,
      20,
      48,
      1,
      (index) => index
    );
    expect(result.rows.map((row) => row.index)).toEqual([1, 2, 3]);
    expect(result.rows[1]?.start).toBe(176);
  });
});
