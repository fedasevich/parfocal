import type { Camera } from "./camera.ts";

export interface LinkedView extends Camera {
  readonly rotation: number;
}

export interface ViewOffset {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
  readonly rotation: number;
}

export type PaneViews<Pane extends string> = Readonly<Record<Pane, LinkedView | null>>;

export interface LinkedViews<Pane extends string> {
  readonly linked: boolean;
  readonly views: PaneViews<Pane>;
  readonly offsets: Readonly<Record<Pane, ViewOffset>>;
}

export const noOffset: ViewOffset = { x: 0, y: 0, zoom: 0, rotation: 0 };

export function isNoOffset(offset: ViewOffset): boolean {
  return offset.x === 0 && offset.y === 0 && offset.zoom === 0 && offset.rotation === 0;
}

export function offsetBetween(from: LinkedView | null, to: LinkedView | null): ViewOffset {
  if (from === null || to === null) return noOffset;
  return {
    x: to.x - from.x,
    y: to.y - from.y,
    zoom: to.zoom - from.zoom,
    rotation: to.rotation - from.rotation,
  };
}

export function shiftView(view: LinkedView, offset: ViewOffset): LinkedView {
  if (isNoOffset(offset)) return view;
  return {
    x: view.x + offset.x,
    y: view.y + offset.y,
    zoom: view.zoom + offset.zoom,
    rotation: view.rotation + offset.rotation,
  };
}

const negate = (offset: ViewOffset): ViewOffset => ({
  x: -offset.x,
  y: -offset.y,
  zoom: -offset.zoom,
  rotation: -offset.rotation,
});

const panesOf = <Pane extends string>(record: Readonly<Record<Pane, unknown>>) =>
  Object.keys(record) as Pane[];

function mapPanes<Pane extends string, Value>(
  panes: readonly Pane[],
  make: (pane: Pane) => Value,
): Record<Pane, Value> {
  const out = {} as Record<Pane, Value>;
  for (const pane of panes) out[pane] = make(pane);
  return out;
}

export function createLinkedViews<Pane extends string>(
  panes: readonly Pane[],
  view: LinkedView | null = null,
): LinkedViews<Pane> {
  return {
    linked: true,
    views: mapPanes(panes, () => view),
    offsets: mapPanes(panes, () => noOffset),
  };
}

export function moveView<Pane extends string>(
  state: LinkedViews<Pane>,
  pane: NoInfer<Pane>,
  view: LinkedView | null,
): LinkedViews<Pane> {
  if (!state.linked) return { ...state, views: { ...state.views, [pane]: view } };
  if (view === null) return { ...state, views: mapPanes(panesOf(state.views), () => null) };
  const shared = shiftView(view, negate(state.offsets[pane]));
  return {
    ...state,
    views: mapPanes(panesOf(state.views), (other) =>
      other === pane ? view : shiftView(shared, state.offsets[other]),
    ),
  };
}

export function unlinkViews<Pane extends string>(state: LinkedViews<Pane>): LinkedViews<Pane> {
  return state.linked ? { ...state, linked: false } : state;
}

export function relinkViews<Pane extends string>(
  state: LinkedViews<Pane>,
  reference: NoInfer<Pane>,
): LinkedViews<Pane> {
  if (state.linked) return state;
  const anchor = state.views[reference];
  return {
    ...state,
    linked: true,
    offsets: mapPanes(panesOf(state.views), (pane) => offsetBetween(anchor, state.views[pane])),
  };
}

export function alignViews<Pane extends string>(
  state: LinkedViews<Pane>,
  reference: NoInfer<Pane>,
): LinkedViews<Pane> {
  const aligned: LinkedViews<Pane> = {
    linked: true,
    views: state.views,
    offsets: mapPanes(panesOf(state.views), () => noOffset),
  };
  return moveView(aligned, reference, state.views[reference]);
}

export function toggleLinked<Pane extends string>(
  state: LinkedViews<Pane>,
  reference: NoInfer<Pane>,
): LinkedViews<Pane> {
  return state.linked ? unlinkViews(state) : relinkViews(state, reference);
}
