import { useEffect, useMemo, useState } from "react";

export interface FixedVirtualRow {
  index: number;
  key: string | number;
  start: number;
  size: number;
}

interface FixedVirtualRowsOptions {
  scrollElement: HTMLElement | null;
  count: number;
  rowHeight: number;
  offset: number;
  overscan?: number;
  getKey: (index: number) => string | number;
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
