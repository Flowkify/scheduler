import { addDays, daysBetween } from "./date";
import type { CreateDraft, SchedulerEntry } from "./types";

export type InteractionMode = "move" | "resize-start" | "resize-end" | "create";

export interface InteractionState<TMeta = unknown> {
  mode: InteractionMode;
  originDate: string;
  originPersonId: string;
  entry?: SchedulerEntry<TMeta>;
  proposedEntry?: SchedulerEntry<TMeta>;
  createDraft?: CreateDraft;
}

export type InteractionAction<TMeta = unknown> =
  | {
      type: "start-entry";
      mode: Exclude<InteractionMode, "create">;
      entry: SchedulerEntry<TMeta>;
      originDate: string;
    }
  | {
      type: "start-create";
      personId: string;
      originDate: string;
    }
  | {
      type: "update";
      currentDate: string;
      targetPersonId: string;
    };

export function interactionReducer<TMeta>(
  state: InteractionState<TMeta> | null,
  action: InteractionAction<TMeta>
): InteractionState<TMeta> | null {
  if (action.type === "start-entry") {
    return {
      mode: action.mode,
      originDate: action.originDate,
      originPersonId: action.entry.personId,
      entry: action.entry,
      proposedEntry: action.entry
    };
  }
  if (action.type === "start-create") {
    return {
      mode: "create",
      originDate: action.originDate,
      originPersonId: action.personId,
      createDraft: {
        personId: action.personId,
        startDate: action.originDate,
        endDate: action.originDate
      }
    };
  }
  if (!state) return state;
  if (state.mode === "create") {
    return {
      ...state,
      createDraft: {
        personId: action.targetPersonId,
        startDate:
          action.currentDate < state.originDate
            ? action.currentDate
            : state.originDate,
        endDate:
          action.currentDate > state.originDate
            ? action.currentDate
            : state.originDate
      }
    };
  }
  if (!state.entry) return state;
  const dayDelta = daysBetween(state.originDate, action.currentDate);
  let proposedEntry: SchedulerEntry<TMeta>;
  if (state.mode === "move") {
    proposedEntry = {
      ...state.entry,
      personId: action.targetPersonId,
      startDate: addDays(state.entry.startDate, dayDelta),
      endDate: addDays(state.entry.endDate, dayDelta)
    };
  } else if (state.mode === "resize-start") {
    const startDate = addDays(state.entry.startDate, dayDelta);
    proposedEntry = {
      ...state.entry,
      startDate:
        startDate > state.entry.endDate ? state.entry.endDate : startDate
    };
  } else {
    const endDate = addDays(state.entry.endDate, dayDelta);
    proposedEntry = {
      ...state.entry,
      endDate: endDate < state.entry.startDate ? state.entry.startDate : endDate
    };
  }
  return { ...state, proposedEntry };
}

