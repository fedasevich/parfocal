export type EscState = {
  overlay: boolean;
  comment: boolean;
  dragging: boolean;
  draft: boolean;
  run: boolean;
  vertex: boolean;
  selection: boolean;
  focusReview: boolean;
  tool: boolean;
  panel: boolean;
};

export type EscLayer =
  | "overlay"
  | "comment"
  | "drag"
  | "draft"
  | "run"
  | "vertex"
  | "selection"
  | "focus"
  | "tool"
  | "panel";

export const escLadder: readonly { layer: EscLayer; open: (state: EscState) => boolean }[] = [
  { layer: "overlay", open: (state) => state.overlay },
  { layer: "comment", open: (state) => state.comment },
  { layer: "drag", open: (state) => state.dragging },
  { layer: "draft", open: (state) => state.draft },
  { layer: "run", open: (state) => state.run },
  { layer: "vertex", open: (state) => state.vertex },
  { layer: "selection", open: (state) => state.selection },
  { layer: "focus", open: (state) => state.focusReview },
  { layer: "tool", open: (state) => state.tool },
  { layer: "panel", open: (state) => state.panel },
];

export const escLayer = (state: EscState): EscLayer | null =>
  escLadder.find((rung) => rung.open(state))?.layer ?? null;

export const typingTarget = (target: EventTarget | null): boolean =>
  target instanceof Element &&
  target.closest("input, textarea, select, [contenteditable=''], [contenteditable=true]") !== null;
