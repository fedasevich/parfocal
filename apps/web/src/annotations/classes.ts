import { type AnnotationDocument, getShape, isShapeLocked, updateShape } from "./document.ts";
import type { ReviewState, RunId, Shape, ShapeId, ShapeKind } from "./shapes.ts";

export interface ClassSlot {
  readonly key: string;
  readonly name: string;
}

export type ClassContext = "annotate" | "review";

export interface ClassState {
  readonly document: AnnotationDocument;
  readonly selection: readonly ShapeId[];
  readonly activeClass: string | null;
}

export interface TeachExample {
  readonly shapeId: ShapeId;
  readonly runId: RunId;
  readonly piece: number;
  readonly fromClass: string | null;
  readonly toClass: string;
}

export interface ClassPick {
  readonly state: ClassState;
  readonly changed: readonly ShapeId[];
  readonly taught: readonly TeachExample[];
}

export const classKeyAction = "aclass";

export const maxClassKeys = 9;

const unclassedKinds: ReadonlySet<ShapeKind> = new Set(["ruler", "arrow", "text"]);

export function takesClass(shape: Shape): boolean {
  return !unclassedKinds.has(shape.kind);
}

export function classAtSlot(classes: readonly ClassSlot[], slot: number): ClassSlot | undefined {
  if (!Number.isInteger(slot) || slot < 1 || slot > maxClassKeys) return undefined;
  return classes[slot - 1];
}

export function slotOfAction(action: string): number | null {
  const prefix = `${classKeyAction}:`;
  if (!action.startsWith(prefix)) return null;
  const slot = Number(action.slice(prefix.length));
  return Number.isInteger(slot) && slot >= 1 && slot <= maxClassKeys ? slot : null;
}

function reviewedState(shape: Shape, toClass: string): ReviewState {
  return shape.classKey === toClass ? "agreed" : "disagreed";
}

export function pickClass(state: ClassState, classKey: string, context: ClassContext): ClassPick {
  if (state.selection.length === 0)
    return { state: { ...state, activeClass: classKey }, changed: [], taught: [] };

  let document = state.document;
  const changed: ShapeId[] = [];
  const taught: TeachExample[] = [];
  for (const id of state.selection) {
    const shape = getShape(document, id);
    if (shape === undefined || !takesClass(shape) || isShapeLocked(document, shape)) continue;
    const fromModel = shape.provenance.kind === "model" ? shape.provenance : null;
    const reviewing = context === "review" && fromModel !== null;
    if (shape.classKey === classKey && !reviewing) continue;
    const patch = reviewing
      ? { classKey, reviewState: reviewedState(shape, classKey) }
      : { classKey };
    document = updateShape(document, id, patch).document;
    changed.push(id);
    if (reviewing && fromModel !== null && shape.classKey !== classKey)
      taught.push({
        shapeId: id,
        runId: fromModel.runId,
        piece: fromModel.piece,
        fromClass: shape.classKey,
        toClass: classKey,
      });
  }
  return { state: { ...state, document }, changed, taught };
}

export function pickClassSlot(
  state: ClassState,
  classes: readonly ClassSlot[],
  slot: number,
  context: ClassContext,
): ClassPick | null {
  const picked = classAtSlot(classes, slot);
  return picked === undefined ? null : pickClass(state, picked.key, context);
}
