import { useEffect, useMemo, useState } from "react";

export interface FixedVirtualRow {
  index: number;
  key: string | number;
  start: number;
  size: number;
}

export type VariableVirtualRow = FixedVirtualRow;

interface FixedVirtualRowsOptions {
  scrollElement: HTMLElement | null;
  count: number;
  rowHeight: number;
  offset: number;
  overscan?: number;
  getKey: (index: number) => string | number;
}

interface VariableVirtualRowsOptions {
  scrollElement: HTMLElement | null;
  sizes: readonly number[];
  offset: number;
  overscan?: number;
  getKey: (index: number) => string | number;
}

export function calculateVariableRows(
  sizes: readonly number[],
  viewportTop: number,
  viewportHeight: number,
  offset: number,
  overscan: number,
  getKey: (index: number) => string | number
): { totalSize: number; rows: VariableVirtualRow[] } {
  const starts: number[] = [];
  let totalSize = 0;
  for (const size of sizes) {
    starts.push(totalSize);
    totalSize += size;
  }
  const visibleTop = Math.max(0, viewportTop - offset);
  const visibleBottom = Math.max(visibleTop, viewportTop + viewportHeight - offset);
  let first = starts.findIndex(
    (start, index) => start + (sizes[index] ?? 0) > visibleTop
  );
  if (first < 0) first = sizes.length;
  let last = first;
  while (last < sizes.length && (starts[last] ?? totalSize) < visibleBottom) {
    last += 1;
  }
  first = Math.max(0, first - overscan);
  last = Math.min(sizes.length, last + overscan);
  return {
    totalSize,
    rows: Array.from({ length: Math.max(0, last - first) }, (_, itemIndex) => {
      const index = first + itemIndex;
      return {
        index,
        key: getKey(index),
        start: starts[index] ?? 0,
        size: sizes[index] ?? 0
      };
    })
  };
}

export function useVariableVirtualRows({
  scrollElement,
  sizes,
  offset,
  overscan = 6,
  getKey
}: VariableVirtualRowsOptions): {
  totalSize: number;
  rows: VariableVirtualRow[];
} {
  const [viewport, setViewport] = useState({ top: 0, height: 600 });

  useEffect(() => {
    if (!scrollElement) return;
    const update = () =>
      setViewport({
        top: scrollElement.scrollTop,
        height: scrollElement.clientHeight || 600
      });
    const observer = new ResizeObserver(update);
    observer.observe(scrollElement);
    scrollElement.addEventListener("scroll", update, { passive: true });
    update();
    return () => {
      observer.disconnect();
      scrollElement.removeEventListener("scroll", update);
    };
  }, [scrollElement]);

  return useMemo(
    () =>
      calculateVariableRows(
        sizes,
        viewport.top,
        viewport.height,
        offset,
        overscan,
        getKey
      ),
    [getKey, offset, overscan, sizes, viewport]
  );
}

export function useFixedVirtualRows({
  scrollElement,
  count,
  rowHeight,
  offset,
  overscan = 6,
  getKey
}: FixedVirtualRowsOptions): {
  totalSize: number;
  rows: FixedVirtualRow[];
} {
  const [viewport, setViewport] = useState({ top: 0, height: 600 });

  useEffect(() => {
    if (!scrollElement) return;
    const update = () =>
      setViewport({
        top: scrollElement.scrollTop,
        height: scrollElement.clientHeight || 600
      });
    const observer = new ResizeObserver(update);
    observer.observe(scrollElement);
    scrollElement.addEventListener("scroll", update, { passive: true });
    update();
    return () => {
      observer.disconnect();
      scrollElement.removeEventListener("scroll", update);
    };
  }, [scrollElement]);

  const rows = useMemo(() => {
    const first = Math.max(
      0,
      Math.floor((viewport.top - offset) / rowHeight) - overscan
    );
    const last = Math.min(
      count,
      Math.ceil((viewport.top + viewport.height - offset) / rowHeight) +
        overscan
    );
    return Array.from({ length: Math.max(0, last - first) }, (_, itemIndex) => {
      const index = first + itemIndex;
      return {
        index,
        key: getKey(index),
        start: index * rowHeight,
        size: rowHeight
      };
    });
  }, [count, getKey, offset, overscan, rowHeight, viewport]);

  return { totalSize: count * rowHeight, rows };
}
