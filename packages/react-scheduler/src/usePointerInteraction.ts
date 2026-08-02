import { useCallback, useEffect, useRef, useState } from "react";
import { addDays } from "./date";
import {
  interactionReducer,
  type InteractionMode,
  type InteractionState
} from "./interaction";
import type { SchedulerEntry, VisibleRange } from "./types";

interface PointerOptions<TMeta> {
  scrollElement: HTMLElement | null;
  range: VisibleRange;
  dayWidth: number;
  personColumnWidth: number;
  onFinish: (state: InteractionState<TMeta>) => void;
  onEntryClick?: (entry: SchedulerEntry<TMeta>) => void;
}

export interface PointerInteraction<TMeta> {
  state: InteractionState<TMeta> | null;
  startEntry: (
    event: React.PointerEvent,
    entry: SchedulerEntry<TMeta>,
    mode: Exclude<InteractionMode, "create">
  ) => void;
  startCreate: (
    event: React.PointerEvent,
    personId: string
  ) => void;
  cancel: () => void;
}

export function usePointerInteraction<TMeta>(
  options: PointerOptions<TMeta>
): PointerInteraction<TMeta> {
  const [state, setState] = useState<InteractionState<TMeta> | null>(null);
  const stateRef = useRef(state);
  const optionsRef = useRef(options);
  const frameRef = useRef<number>();
  stateRef.current = state;
  optionsRef.current = options;

  const dateFromPointer = useCallback((clientX: number): string => {
    const current = optionsRef.current;
    const scroll = current.scrollElement;
    if (!scroll) return current.range.startDate;
    const rect = scroll.getBoundingClientRect();
    const timelineX =
      clientX - rect.left - current.personColumnWidth + scroll.scrollLeft;
    const maxDay = Math.max(
      0,
      Math.round(
        (Date.parse(`${current.range.endDate}T00:00:00Z`) -
          Date.parse(`${current.range.startDate}T00:00:00Z`)) /
          86_400_000
      )
    );
    const index = Math.max(
      0,
      Math.min(maxDay, Math.floor(timelineX / current.dayWidth))
    );
    return addDays(current.range.startDate, index);
  }, []);

  const personFromPointer = useCallback(
    (clientX: number, clientY: number, fallback: string): string => {
      const element = document.elementFromPoint(clientX, clientY);
      return (
        element?.closest<HTMLElement>("[data-person-id]")?.dataset.personId ??
        fallback
      );
    },
    []
  );

  const onPointerMove = useCallback(
    (event: PointerEvent) => {
      const current = stateRef.current;
      const optionsValue = optionsRef.current;
      if (!current || !optionsValue.scrollElement) return;
      const scroll = optionsValue.scrollElement;
      const rect = scroll.getBoundingClientRect();
      const edge = 36;
      if (event.clientX > rect.right - edge) scroll.scrollLeft += 12;
      else if (event.clientX < rect.left + optionsValue.personColumnWidth + edge)
        scroll.scrollLeft -= 12;
      if (event.clientY > rect.bottom - edge) scroll.scrollTop += 10;
      else if (event.clientY < rect.top + 96) scroll.scrollTop -= 10;

      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      frameRef.current = requestAnimationFrame(() => {
        const latest = stateRef.current;
        if (!latest) return;
        setState((value) => {
          const next = interactionReducer(value, {
            type: "update",
            currentDate: dateFromPointer(event.clientX),
            targetPersonId: personFromPointer(
              event.clientX,
              event.clientY,
              latest.originPersonId
            )
          });
          stateRef.current = next;
          return next;
        });
      });
    },
    [dateFromPointer, personFromPointer]
  );

  const removeListeners = useCallback(() => {
    window.removeEventListener("pointermove", onPointerMove);
  }, [onPointerMove]);

  const onPointerUp = useCallback(() => {
    removeListeners();
    const completed = stateRef.current;
    stateRef.current = null;
    setState(null);
    if (!completed) return;
    const clicked =
      completed.mode === "move" &&
      completed.entry &&
      completed.proposedEntry &&
      completed.entry.personId === completed.proposedEntry.personId &&
      completed.entry.startDate === completed.proposedEntry.startDate &&
      completed.entry.endDate === completed.proposedEntry.endDate;
    if (clicked && completed.entry)
      optionsRef.current.onEntryClick?.(completed.entry);
    else optionsRef.current.onFinish(completed);
  }, [removeListeners]);

  const begin = useCallback(
    (next: InteractionState<TMeta> | null) => {
      stateRef.current = next;
      setState(next);
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp, { once: true });
    },
    [onPointerMove, onPointerUp]
  );

  const startEntry = useCallback(
    (
      event: React.PointerEvent,
      entry: SchedulerEntry<TMeta>,
      mode: Exclude<InteractionMode, "create">
    ) => {
      if (event.button !== 0 || entry.readOnly || stateRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      begin(
        interactionReducer(null, {
          type: "start-entry",
          entry,
          mode,
          originDate: dateFromPointer(event.clientX)
        })
      );
    },
    [begin, dateFromPointer]
  );

  const startCreate = useCallback(
    (event: React.PointerEvent, personId: string) => {
      if (event.button !== 0 || stateRef.current) return;
      const target = event.target as HTMLElement;
      if (target.closest("[data-entry-id], button, input")) return;
      event.preventDefault();
      const originDate = dateFromPointer(event.clientX);
      begin(
        interactionReducer(null, {
          type: "start-create",
          personId,
          originDate
        })
      );
    },
    [begin, dateFromPointer]
  );

  const cancel = useCallback(() => {
    removeListeners();
    window.removeEventListener("pointerup", onPointerUp);
    stateRef.current = null;
    setState(null);
  }, [onPointerUp, removeListeners]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && stateRef.current) cancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cancel]);

  useEffect(
    () => () => {
      removeListeners();
      window.removeEventListener("pointerup", onPointerUp);
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    },
    [onPointerUp, removeListeners]
  );

  return { state, startEntry, startCreate, cancel };
}
