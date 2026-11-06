import { hasPiece, type ModelRun, pieceConfidence, pieceRing } from "./runs.ts";
import {
  boundsOf,
  type Geometry,
  type GroupId,
  InvalidShapeError,
  type Provenance,
  type ReviewState,
  type RunId,
  type Shape,
  type ShapeId,
  type ShapeKind,
  singleRing,
  translateGeometry,
  validateGeometry,
} from "./shapes.ts";

export interface Group {
  readonly id: GroupId;
  readonly name: string;
  readonly parentId: GroupId | null;
  readonly color: readonly [number, number, number] | null;
  readonly hidden: boolean;
  readonly locked: boolean;
}

export interface AnnotationDocument {
  readonly shapes: ReadonlyMap<ShapeId, Shape>;
  readonly groups: ReadonlyMap<GroupId, Group>;
  readonly runs: ReadonlyMap<RunId, ModelRun>;
  readonly promoted: ReadonlyMap<string, ShapeId>;
  readonly dismissed: ReadonlySet<string>;
  readonly pins: ReadonlyMap<string, PinPlacement>;
  readonly nextShapeId: ShapeId;
  readonly nextGroupId: GroupId;
}

export interface PinPlacement {
  readonly shapeId: ShapeId | null;
  readonly offset: { readonly x: number; readonly y: number };
}

export interface NewShape {
  readonly kind: ShapeKind;
  readonly points: Float32Array;
  readonly ringStarts?: Uint32Array;
  readonly classKey?: string | null;
  readonly groupId?: GroupId | null;
  readonly text?: string | null;
  readonly reviewState?: ReviewState;
}

export interface ShapePatch {
  readonly geometry?: Geometry;
  readonly classKey?: string | null;
  readonly groupId?: GroupId | null;
  readonly text?: string | null;
  readonly reviewState?: ReviewState;
}

export interface GroupPatch {
  readonly name?: string;
  readonly parentId?: GroupId | null;
  readonly color?: readonly [number, number, number] | null;
  readonly hidden?: boolean;
  readonly locked?: boolean;
}

export interface PromotionPatch {
  readonly classKey?: string | null;
  readonly groupId?: GroupId | null;
  readonly reviewState?: ReviewState;
}

export interface ShapeChange {
  readonly document: AnnotationDocument;
  readonly shape: Shape;
}

export class UnknownEntryError extends Error {
  constructor(what: string, id: number) {
    super(`No ${what} ${id} in the document`);
    this.name = "UnknownEntryError";
  }
}

export const maxGroupDepth = 64;

export function createDocument(): AnnotationDocument {
  return {
    shapes: new Map(),
    groups: new Map(),
    runs: new Map(),
    promoted: new Map(),
    dismissed: new Set(),
    pins: new Map(),
    nextShapeId: 1,
    nextGroupId: 1,
  };
}

export function pieceKey(runId: RunId, piece: number): string {
  return `${runId}:${piece}`;
}

function requireShape(doc: AnnotationDocument, id: ShapeId): Shape {
  const shape = doc.shapes.get(id);
  if (!shape) throw new UnknownEntryError("shape", id);
  return shape;
}

function requireGroup(doc: AnnotationDocument, id: GroupId | null): void {
  if (id !== null && !doc.groups.has(id)) throw new UnknownEntryError("group", id);
}

function requireText(kind: ShapeKind, text: string | null): void {
  if (kind === "text" && (text === null || text.trim() === "")) {
    throw new InvalidShapeError("text needs words to show");
  }
  if (kind !== "text" && text !== null) {
    throw new InvalidShapeError(`${kind} carries no text`);
  }
}

function withShape(doc: AnnotationDocument, shape: Shape): AnnotationDocument {
  const shapes = new Map(doc.shapes);
  shapes.set(shape.id, shape);
  return { ...doc, shapes };
}

function buildShape(
  id: ShapeId,
  input: NewShape,
  provenance: Provenance,
  threadIds: readonly string[] = [],
): Shape {
  const geometry = {
    points: input.points,
    ringStarts: input.ringStarts ?? singleRing(input.points).ringStarts,
  };
  validateGeometry(input.kind, geometry);
  const text = input.text ?? null;
  requireText(input.kind, text);
  return {
    id,
    kind: input.kind,
    points: geometry.points,
    ringStarts: geometry.ringStarts,
    classKey: input.classKey ?? null,
    groupId: input.groupId ?? null,
    text,
    provenance,
    reviewState: input.reviewState ?? "unreviewed",
    threadIds,
    bounds: boundsOf(geometry.points),
  };
}

export function addShape(doc: AnnotationDocument, input: NewShape): ShapeChange {
  requireGroup(doc, input.groupId ?? null);
  const shape = buildShape(doc.nextShapeId, input, { kind: "human" });
  return {
    document: { ...withShape(doc, shape), nextShapeId: shape.id + 1 },
    shape,
  };
}

export function addRestoredShape(
  doc: AnnotationDocument,
  input: NewShape,
  provenance: Provenance,
  threadIds: readonly string[],
): ShapeChange {
  requireGroup(doc, input.groupId ?? null);
  const shape = buildShape(doc.nextShapeId, input, provenance, threadIds);
  return {
    document: { ...withShape(doc, shape), nextShapeId: shape.id + 1 },
    shape,
  };
}

export function placePin(
  doc: AnnotationDocument,
  threadId: string,
  pin: PinPlacement,
): AnnotationDocument {
  if (pin.shapeId !== null) requireShape(doc, pin.shapeId);
  const pins = new Map(doc.pins);
  pins.set(threadId, pin);
  return { ...doc, pins };
}

export function updateShape(doc: AnnotationDocument, id: ShapeId, patch: ShapePatch): ShapeChange {
  const current = requireShape(doc, id);
  if (patch.groupId !== undefined) requireGroup(doc, patch.groupId);

  const geometry = patch.geometry ?? current;
  if (patch.geometry) validateGeometry(current.kind, patch.geometry);
  const text = patch.text === undefined ? current.text : patch.text;
  requireText(current.kind, text);

  const provenance: Provenance =
    patch.geometry && current.provenance.kind === "model"
      ? { ...current.provenance, edited: true }
      : current.provenance;

  const shape: Shape = {
    ...current,
    points: geometry.points,
    ringStarts: geometry.ringStarts,
    bounds: patch.geometry ? boundsOf(geometry.points) : current.bounds,
    classKey: patch.classKey === undefined ? current.classKey : patch.classKey,
    groupId: patch.groupId === undefined ? current.groupId : patch.groupId,
    text,
    reviewState: patch.reviewState ?? current.reviewState,
    provenance,
  };
  return { document: withShape(doc, shape), shape };
}

export function moveShape(
  doc: AnnotationDocument,
  id: ShapeId,
  dx: number,
  dy: number,
): ShapeChange {
  return updateShape(doc, id, { geometry: translateGeometry(requireShape(doc, id), dx, dy) });
}

export function removeShape(doc: AnnotationDocument, id: ShapeId): AnnotationDocument {
  const shape = requireShape(doc, id);
  const shapes = new Map(doc.shapes);
  shapes.delete(id);
  if (shape.provenance.kind !== "model") return { ...doc, shapes };
  const promoted = new Map(doc.promoted);
  promoted.delete(pieceKey(shape.provenance.runId, shape.provenance.piece));
  return { ...doc, shapes, promoted };
}

export function linkThread(doc: AnnotationDocument, id: ShapeId, threadId: string): ShapeChange {
  const current = requireShape(doc, id);
  if (current.threadIds.includes(threadId)) return { document: doc, shape: current };
  const shape = { ...current, threadIds: [...current.threadIds, threadId] };
  return { document: withShape(doc, shape), shape };
}

export function unlinkThread(doc: AnnotationDocument, id: ShapeId, threadId: string): ShapeChange {
  const current = requireShape(doc, id);
  if (!current.threadIds.includes(threadId)) return { document: doc, shape: current };
  const shape = { ...current, threadIds: current.threadIds.filter((entry) => entry !== threadId) };
  return { document: withShape(doc, shape), shape };
}

export function getShape(doc: AnnotationDocument, id: ShapeId): Shape | undefined {
  return doc.shapes.get(id);
}

export function listShapes(doc: AnnotationDocument): Shape[] {
  return [...doc.shapes.values()];
}

export function shapesOfThread(doc: AnnotationDocument, threadId: string): Shape[] {
  return listShapes(doc).filter((shape) => shape.threadIds.includes(threadId));
}

export function addGroup(
  doc: AnnotationDocument,
  name: string,
  patch: Omit<GroupPatch, "name"> = {},
): { document: AnnotationDocument; group: Group } {
  requireGroup(doc, patch.parentId ?? null);
  const group: Group = {
    id: doc.nextGroupId,
    name,
    parentId: patch.parentId ?? null,
    color: patch.color ?? null,
    hidden: patch.hidden ?? false,
    locked: patch.locked ?? false,
  };
  const groups = new Map(doc.groups);
  groups.set(group.id, group);
  return { document: { ...doc, groups, nextGroupId: group.id + 1 }, group };
}

export function updateGroup(
  doc: AnnotationDocument,
  id: GroupId,
  patch: GroupPatch,
): { document: AnnotationDocument; group: Group } {
  const current = doc.groups.get(id);
  if (!current) throw new UnknownEntryError("group", id);
  if (patch.parentId !== undefined) {
    requireGroup(doc, patch.parentId);
    if (patch.parentId !== null && groupChain(doc, patch.parentId).some((g) => g.id === id)) {
      throw new RangeError("A group cannot sit inside itself");
    }
  }
  const group: Group = { ...current, ...patch };
  const groups = new Map(doc.groups);
  groups.set(id, group);
  return { document: { ...doc, groups }, group };
}

export function removeGroup(doc: AnnotationDocument, id: GroupId): AnnotationDocument {
  const removed = doc.groups.get(id);
  if (!removed) throw new UnknownEntryError("group", id);
  const groups = new Map(doc.groups);
  groups.delete(id);
  for (const group of doc.groups.values()) {
    if (group.parentId === id) groups.set(group.id, { ...group, parentId: removed.parentId });
  }
  const shapes = new Map(doc.shapes);
  for (const shape of doc.shapes.values()) {
    if (shape.groupId === id) shapes.set(shape.id, { ...shape, groupId: removed.parentId });
  }
  return { ...doc, groups, shapes };
}

export function groupChain(doc: AnnotationDocument, id: GroupId | null): Group[] {
  const chain: Group[] = [];
  const seen = new Set<GroupId>();
  let cursor = id;
  while (cursor !== null && chain.length < maxGroupDepth && !seen.has(cursor)) {
    seen.add(cursor);
    const group = doc.groups.get(cursor);
    if (!group) break;
    chain.push(group);
    cursor = group.parentId;
  }
  return chain;
}

export function groupPath(doc: AnnotationDocument, id: GroupId | null): string {
  return groupChain(doc, id)
    .reverse()
    .map((group) => group.name)
    .join(" / ");
}

export function isShapeHidden(doc: AnnotationDocument, shape: Shape): boolean {
  return groupChain(doc, shape.groupId).some((group) => group.hidden);
}

export function isShapeLocked(doc: AnnotationDocument, shape: Shape): boolean {
  return groupChain(doc, shape.groupId).some((group) => group.locked);
}

export function visibleShapes(doc: AnnotationDocument): Shape[] {
  return listShapes(doc).filter((shape) => !isShapeHidden(doc, shape));
}

export function addRun(doc: AnnotationDocument, run: ModelRun): AnnotationDocument {
  const runs = new Map(doc.runs);
  runs.set(run.id, run);
  return { ...doc, runs };
}

export function removeRun(doc: AnnotationDocument, id: RunId): AnnotationDocument {
  if (!doc.runs.has(id)) throw new UnknownEntryError("run", id);
  const runs = new Map(doc.runs);
  runs.delete(id);
  const promoted = new Map(doc.promoted);
  for (const key of doc.promoted.keys()) {
    if (key.startsWith(`${id}:`)) promoted.delete(key);
  }
  const dismissed = new Set([...doc.dismissed].filter((key) => !key.startsWith(`${id}:`)));
  return { ...doc, runs, promoted, dismissed };
}

export function promotedShape(
  doc: AnnotationDocument,
  runId: RunId,
  piece: number,
): Shape | undefined {
  const id = doc.promoted.get(pieceKey(runId, piece));
  return id === undefined ? undefined : doc.shapes.get(id);
}

export function openPieces(doc: AnnotationDocument, runId: RunId): number[] {
  const run = doc.runs.get(runId);
  if (!run) throw new UnknownEntryError("run", runId);
  const open: number[] = [];
  for (let piece = 0; piece < run.count; piece++) {
    const key = pieceKey(runId, piece);
    if (!doc.promoted.has(key) && !doc.dismissed.has(key)) open.push(piece);
  }
  return open;
}

export function promoteRunPiece(
  doc: AnnotationDocument,
  runId: RunId,
  piece: number,
  patch: PromotionPatch = {},
): ShapeChange {
  const run = doc.runs.get(runId);
  if (!run) throw new UnknownEntryError("run", runId);
  if (!hasPiece(run, piece)) throw new UnknownEntryError("piece", piece);

  const existing = promotedShape(doc, runId, piece);
  if (existing) return { document: doc, shape: existing };

  requireGroup(doc, patch.groupId ?? null);
  const shape = buildShape(
    doc.nextShapeId,
    {
      kind: "polygon",
      points: pieceRing(run, piece).slice(),
      classKey: patch.classKey === undefined ? run.classKey : patch.classKey,
      groupId: patch.groupId ?? null,
      reviewState: patch.reviewState ?? "unreviewed",
    },
    {
      kind: "model",
      model: run.model,
      version: run.version,
      runId,
      piece,
      confidence: pieceConfidence(run, piece),
      edited: false,
    },
  );
  const promoted = new Map(doc.promoted);
  promoted.set(pieceKey(runId, piece), shape.id);
  return {
    document: { ...withShape(doc, shape), promoted, nextShapeId: shape.id + 1 },
    shape,
  };
}
