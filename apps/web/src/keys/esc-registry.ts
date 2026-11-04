import { type EscLayer, type EscState, escLayer } from "./esc-ladder.ts";

export type EscRung = { readonly open: () => boolean; readonly peel: () => void };

export type EscRegistry = {
  readonly add: (layer: EscLayer, rung: EscRung) => () => void;
  readonly state: () => EscState;
  readonly peel: (layer: EscLayer) => boolean;
};

const stateKeys: Record<EscLayer, keyof EscState> = {
  overlay: "overlay",
  comment: "comment",
  drag: "dragging",
  draft: "draft",
  run: "run",
  vertex: "vertex",
  selection: "selection",
  focus: "focusReview",
  tool: "tool",
  panel: "panel",
};

export function createEscRegistry(): EscRegistry {
  const entries = new Set<{ layer: EscLayer; rung: EscRung }>();
  const open = (layer: EscLayer) =>
    [...entries].some((entry) => entry.layer === layer && entry.rung.open());
  return {
    add: (layer, rung) => {
      const entry = { layer, rung };
      entries.add(entry);
      return () => {
        entries.delete(entry);
      };
    },
    state: () => {
      const state: EscState = {
        overlay: false,
        comment: false,
        dragging: false,
        draft: false,
        run: false,
        vertex: false,
        selection: false,
        focusReview: false,
        tool: false,
        panel: false,
      };
      for (const layer of Object.keys(stateKeys) as EscLayer[]) {
        state[stateKeys[layer]] = open(layer);
      }
      return state;
    },
    peel: (layer) => {
      const entry = [...entries].find((item) => item.layer === layer && item.rung.open());
      if (entry === undefined) return false;
      entry.rung.peel();
      return true;
    },
  };
}
