import { and, assign, setup, stateIn } from "xstate";
import type { MapRect, MinimapSize } from "./minimap-box.ts";

export const areaMagnification = 20;

export const hiddenAboveShare = 0.5;

export const fadeDistance = 40;

export const areaPadding = 0.12;

export type MinimapMode = "hidden" | "reading" | "area" | "locator" | "travel";

export type MinimapContext = {
  tissueShare: number;
  magnification: number;
  focus: boolean;
  skips: number;
};

export type MinimapEvent =
  | { type: "CAMERA"; tissueShare: number; magnification: number }
  | { type: "FOCUS_ENTER" }
  | { type: "FOCUS_EXIT" }
  | { type: "ESC" }
  | { type: "TRAVEL_START" }
  | { type: "TRAVEL_SKIP" }
  | { type: "TRAVEL_ARRIVE" }
  | { type: "POINTER"; distance: number }
  | { type: "PEEK_HOLD_START" }
  | { type: "PEEK_HOLD_END" }
  | { type: "PEEK_TAP" }
  | { type: "PEEK_CLOSE" }
  | { type: "MAP_CLICK" };

export const initialMinimapContext: MinimapContext = {
  tissueShare: 1,
  magnification: 0,
  focus: false,
  skips: 0,
};

const mostOfTissue = ({ context }: { context: MinimapContext }) =>
  context.tissueShare > hiddenAboveShare;

const zoomedPastArea = ({ context }: { context: MinimapContext }) =>
  context.magnification >= areaMagnification;

const inFocus = ({ context }: { context: MinimapContext }) => context.focus;

export const minimapMachine = setup({
  types: {
    context: {} as MinimapContext,
    events: {} as MinimapEvent,
    input: undefined as Partial<MinimapContext> | undefined,
  },
  guards: {
    mostOfTissue,
    zoomedPastArea,
    inFocus,
    notInFocus: (args) => !inFocus(args),
    belowArea: (args) => !zoomedPastArea(args),
    hasRoom: (args) => !mostOfTissue(args),
    pointerNear: ({ event }) => event.type === "POINTER" && event.distance <= fadeDistance,
    pointerAway: ({ event }) => event.type === "POINTER" && event.distance > fadeDistance,
  },
  actions: {
    takeCamera: assign(({ event }) =>
      event.type === "CAMERA"
        ? { tissueShare: event.tissueShare, magnification: event.magnification }
        : {},
    ),
    enterFocus: assign({ focus: true }),
    leaveFocus: assign({ focus: false }),
    countSkip: assign({ skips: ({ context }) => context.skips + 1 }),
    resetSkips: assign({ skips: 0 }),
  },
}).createMachine({
  id: "minimap",
  context: ({ input }) => ({ ...initialMinimapContext, ...input }),
  type: "parallel",
  on: {
    CAMERA: { actions: "takeCamera" },
    FOCUS_ENTER: { actions: "enterFocus" },
    FOCUS_EXIT: { actions: "leaveFocus" },
    ESC: {
      guard: and(["inFocus", stateIn({ peek: "closed" })]),
      actions: "leaveFocus",
    },
  },
  states: {
    mode: {
      initial: "hidden",
      states: {
        hidden: {
          always: [{ guard: "hasRoom", target: "reading" }],
        },
        reading: {
          always: [
            { guard: "mostOfTissue", target: "hidden" },
            { guard: "zoomedPastArea", target: "area" },
          ],
          on: { TRAVEL_START: { target: "travel" } },
        },
        area: {
          always: [
            { guard: "mostOfTissue", target: "hidden" },
            { guard: "inFocus", target: "locator" },
            { guard: "belowArea", target: "reading" },
          ],
          on: { TRAVEL_START: { target: "travel" } },
        },
        locator: {
          always: [{ guard: "notInFocus", target: "area" }],
          on: { TRAVEL_START: { target: "travel" } },
        },
        travel: {
          entry: "resetSkips",
          on: {
            TRAVEL_SKIP: { actions: "countSkip" },
            TRAVEL_ARRIVE: { target: "reading" },
          },
        },
      },
    },
    fade: {
      initial: "clear",
      states: {
        clear: { on: { POINTER: { guard: "pointerNear", target: "faded" } } },
        faded: { on: { POINTER: { guard: "pointerAway", target: "clear" } } },
      },
    },
    peek: {
      initial: "closed",
      states: {
        closed: {
          on: {
            PEEK_HOLD_START: "held",
            PEEK_TAP: "latched",
            MAP_CLICK: "latched",
          },
        },
        held: {
          on: {
            PEEK_HOLD_END: "closed",
            PEEK_CLOSE: "closed",
            ESC: "closed",
          },
        },
        latched: {
          on: {
            PEEK_HOLD_START: "closing",
            PEEK_CLOSE: "closed",
            ESC: "closed",
          },
        },
        closing: {
          on: {
            PEEK_TAP: "closed",
            PEEK_HOLD_END: "closed",
          },
        },
      },
    },
  },
});

export type PeekState = "closed" | "held" | "latched" | "closing";

export type MinimapValue = { mode: MinimapMode; fade: "clear" | "faded"; peek: PeekState };

export const modeSize: Record<Exclude<MinimapMode, "hidden">, MinimapSize> = {
  reading: "full",
  area: "compact",
  locator: "pip",
  travel: "travel",
};

export function sizeOfMode(mode: MinimapMode): MinimapSize | "hidden" {
  return mode === "hidden" ? "hidden" : modeSize[mode];
}

export const peekIsOpen = (peek: PeekState) => peek === "held" || peek === "latched";

export function paddedArea(area: MapRect, bounds: MapRect): MapRect {
  const pad = Math.max(area[2], area[3]) * areaPadding;
  const left = Math.max(bounds[0], area[0] - pad);
  const top = Math.max(bounds[1], area[1] - pad);
  const right = Math.min(bounds[0] + bounds[2], area[0] + area[2] + pad);
  const bottom = Math.min(bounds[1] + bounds[3], area[1] + area[3] + pad);
  return [left, top, right - left, bottom - top];
}

export function mapExtent(mode: Exclude<MinimapMode, "hidden">, slide: MapRect, area: MapRect) {
  return mode === "area" || mode === "locator" ? paddedArea(area, slide) : slide;
}

export function pointerDistance(
  pointer: readonly [number, number],
  box: { left: number; top: number; width: number; height: number },
) {
  const dx = Math.max(box.left - pointer[0], 0, pointer[0] - (box.left + box.width));
  const dy = Math.max(box.top - pointer[1], 0, pointer[1] - (box.top + box.height));
  return Math.hypot(dx, dy);
}
