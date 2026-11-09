import type { AiOutline } from "@parfocal/api-client";
import { keyRegistry } from "../keys/catalogue.ts";
import type { Binding, Fired } from "../keys/registry.ts";
import type { CheckState } from "./check-state.ts";

export const guideAction = "gguide";
export const nextAction = "gnext";
export const deleteAction = "gdelete";
export const classAction = "gclass";

export const guidedActions = [nextAction, deleteAction, classAction];

export function guidedBindings(): Binding[] {
  return keyRegistry.bindings({ scopes: ["annotate"], only: [guideAction, ...guidedActions] });
}

export const guides = (fired: Fired) => fired.phase === "press" && fired.action === guideAction;

export type Queued = {
  readonly object: string;
  readonly number: number;
  readonly score: number | null;
  readonly check: CheckState;
};

export type GuidedState = {
  readonly skipped: readonly string[];
  readonly pinned: string | null;
};

export const startState: GuidedState = { skipped: [], pinned: null };

function leastSure(left: Queued, right: Queued) {
  if (left.score !== right.score) {
    if (left.score === null) return 1;
    if (right.score === null) return -1;
    return left.score - right.score;
  }
  return left.number - right.number;
}

export function checkQueueOf(objects: readonly Queued[], skipped: readonly string[]): string[] {
  const open = objects.filter((object) => object.check === "unchecked").sort(leastSure);
  const later = new Set(skipped);
  return [
    ...open.filter((object) => !later.has(object.object)),
    ...open.filter((object) => later.has(object.object)),
  ].map((object) => object.object);
}

export function currentOf(queue: readonly string[], state: GuidedState): string | null {
  if (state.pinned !== null && queue.includes(state.pinned)) return state.pinned;
  return queue[0] ?? null;
}

export function skippedState(queue: readonly string[], state: GuidedState): GuidedState {
  const current = currentOf(queue, state);
  if (current === null) return state;
  const following = queue[queue.indexOf(current) + 1] ?? queue.find((id) => id !== current) ?? null;
  return {
    skipped: state.skipped.includes(current) ? state.skipped : [...state.skipped, current],
    pinned: following,
  };
}

export function nextClassOf(classIds: readonly string[], current: string | null): string | null {
  if (classIds.length === 0) return null;
  const at = current === null ? -1 : classIds.indexOf(current);
  const next = classIds[(at + 1) % classIds.length] ?? null;
  return next === current ? null : next;
}

export type Area = { x: number; y: number; width: number; height: number };

const smallestView = 320;
const margin = 3;

export function areaAround(geometry: AiOutline): Area | null {
  const rings =
    geometry.type === "Polygon"
      ? [geometry.coordinates[0] ?? []]
      : geometry.coordinates.map((polygon) => polygon[0] ?? []);
  const points = rings.flat();
  if (points.length === 0) return null;
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const width = Math.max(Math.max(...xs) - left, 1);
  const height = Math.max(Math.max(...ys) - top, 1);
  const side = Math.max(Math.max(width, height) * margin, smallestView);
  return {
    x: left + width / 2 - side / 2,
    y: top + height / 2 - side / 2,
    width: side,
    height: side,
  };
}
