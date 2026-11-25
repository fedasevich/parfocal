import {
  type AnnotationDocument,
  addGroup,
  type Group,
  groupChain,
  itemOf,
  type LayerItem,
  updateGroup,
} from "./document.ts";
import {
  colourToCss,
  hexOfRgb,
  type LayerClass,
  type LayerContext,
  moveToGroup,
  rgbOfHex,
  usableTarget,
} from "./layers.ts";
import type { Extent, GroupId, Shape, ShapeId } from "./shapes.ts";

export const noClassName = "No class";

export const treeRowPx = 28;

export const groupPickLimit = 200;

export const itemNameLimit = 80;

const fallbackColour = "var(--fg-faint)";

export interface GroupRow {
  readonly kind: "group";
  readonly key: string;
  readonly groupId: GroupId | null;
  readonly classKey: string | null;
  readonly name: string;
  readonly colour: string;
  readonly hex: string;
  readonly count: number;
  readonly depth: number;
  readonly hidden: boolean;
  readonly locked: boolean;
  readonly hiddenAbove: boolean;
  readonly lockedAbove: boolean;
  readonly expanded: boolean;
  readonly parentKey: string | null;
}

export interface ShapeRow {
  readonly kind: "shape";
  readonly key: string;
  readonly shapeId: ShapeId;
  readonly groupId: GroupId | null;
  readonly label: string;
  readonly name: string | null;
  readonly colour: string;
  readonly depth: number;
  readonly hidden: boolean;
  readonly locked: boolean;
  readonly hiddenAbove: boolean;
  readonly lockedAbove: boolean;
  readonly parentKey: string;
}

export type TreeRow = GroupRow | ShapeRow;

export interface Tree {
  readonly rows: readonly TreeRow[];
  readonly hiddenObjects: number;
}

export type DropPlace = "before" | "after" | "into";

export interface DropTarget {
  readonly key: string;
  readonly place: DropPlace;
}

export const groupKey = (id: GroupId) => `g:${id}`;

export const classGroupKey = (classKey: string | null) => `c:${classKey ?? ""}`;

export const shapeKey = (id: ShapeId) => `s:${id}`;

export type ParsedKey =
  | { readonly kind: "group"; readonly id: GroupId }
  | { readonly kind: "class"; readonly classKey: string | null }
  | { readonly kind: "shape"; readonly id: ShapeId };

export function parseKey(key: string): ParsedKey | null {
  const tag = key.slice(0, 2);
  const rest = key.slice(2);
  if (tag === "c:") return { kind: "class", classKey: rest === "" ? null : rest };
  const id = Number(rest);
  if (!Number.isInteger(id)) return null;
  if (tag === "g:") return { kind: "group", id };
  if (tag === "s:") return { kind: "shape", id };
  return null;
}

export const shapeOrder = (doc: AnnotationDocument, shape: Shape): number =>
  doc.items?.get(shape.id)?.rank ?? shape.id;

export const groupOrder = (group: Group): number => group.rank ?? group.id;

const byShapeOrder = (doc: AnnotationDocument) => (a: Shape, b: Shape) =>
  shapeOrder(doc, a) - shapeOrder(doc, b) || a.id - b.id;

const byGroupOrder = (a: Group, b: Group) => groupOrder(a) - groupOrder(b) || a.id - b.id;

const homeOf = (doc: AnnotationDocument, shape: Shape): GroupId | null =>
  shape.groupId !== null && doc.groups.has(shape.groupId) ? shape.groupId : null;

const parentOf = (doc: AnnotationDocument, group: Group): GroupId | null =>
  group.parentId !== null && doc.groups.has(group.parentId) ? group.parentId : null;

interface Index {
  readonly children: ReadonlyMap<GroupId | null, readonly Group[]>;
  readonly direct: ReadonlyMap<GroupId, Shape[]>;
  readonly loose: ReadonlyMap<string, Shape[]>;
}

function indexOf(doc: AnnotationDocument): Index {
  const children = new Map<GroupId | null, Group[]>();
  for (const group of doc.groups.values()) {
    const parent = parentOf(doc, group);
    const list = children.get(parent);
    if (list) list.push(group);
    else children.set(parent, [group]);
  }
  for (const list of children.values()) list.sort(byGroupOrder);
  const direct = new Map<GroupId, Shape[]>();
  const loose = new Map<string, Shape[]>();
  for (const shape of doc.shapes.values()) {
    const home = homeOf(doc, shape);
    if (home === null) {
      const key = shape.classKey ?? "";
      const list = loose.get(key);
      if (list) list.push(shape);
      else loose.set(key, [shape]);
      continue;
    }
    const list = direct.get(home);
    if (list) list.push(shape);
    else direct.set(home, [shape]);
  }
  return { children, direct, loose };
}

function dominant(counts: ReadonlyMap<string, number>): string | null {
  let best: string | null = null;
  let most = 0;
  for (const [key, count] of counts) {
    if (count > most) {
      best = key;
      most = count;
    }
  }
  return best;
}

function looseOrder(loose: ReadonlyMap<string, Shape[]>, classes: readonly LayerClass[]): string[] {
  const rank = new Map(classes.map((item, index) => [item.id, index]));
  return [...loose.keys()].sort((a, b) => {
    const left = a === "" ? Number.MAX_SAFE_INTEGER : (rank.get(a) ?? classes.length);
    const right = b === "" ? Number.MAX_SAFE_INTEGER : (rank.get(b) ?? classes.length);
    return left - right || a.localeCompare(b);
  });
}

export function treeRows(
  doc: AnnotationDocument,
  context: LayerContext,
  expanded: ReadonlySet<string>,
  labelOf: (shape: Shape) => string,
): Tree {
  const classes = new Map(context.classes.map((item) => [item.id, item]));
  const { children, direct, loose } = indexOf(doc);
  const classColour = (classKey: string | null) =>
    (classKey === null ? undefined : classes.get(classKey)?.colour) ?? "";
  const rows: TreeRow[] = [];
  const sortShapes = byShapeOrder(doc);
  const shapeRow = (
    shape: Shape,
    depth: number,
    parentKey: string,
    hiddenAbove: boolean,
    lockedAbove: boolean,
  ): ShapeRow => {
    const item = itemOf(doc, shape.id);
    return {
      kind: "shape",
      key: shapeKey(shape.id),
      shapeId: shape.id,
      groupId: homeOf(doc, shape),
      label: labelOf(shape),
      name: item.name,
      colour: classColour(shape.classKey) || fallbackColour,
      depth,
      hidden: item.hidden,
      locked: item.locked,
      hiddenAbove,
      lockedAbove,
      parentKey,
    };
  };
  const visited = new Set<GroupId>();
  const tally = new Map<GroupId, { count: number; classes: Map<string, number> }>();
  const measure = (group: Group): { count: number; classes: Map<string, number> } => {
    const known = tally.get(group.id);
    if (known) return known;
    const classesHere = new Map<string, number>();
    let count = 0;
    for (const shape of direct.get(group.id) ?? []) {
      count += 1;
      if (shape.classKey !== null) {
        classesHere.set(shape.classKey, (classesHere.get(shape.classKey) ?? 0) + 1);
      }
    }
    tally.set(group.id, { count, classes: classesHere });
    for (const child of children.get(group.id) ?? []) {
      const below = measure(child);
      count += below.count;
      for (const [key, value] of below.classes) {
        classesHere.set(key, (classesHere.get(key) ?? 0) + value);
      }
    }
    const result = { count, classes: classesHere };
    tally.set(group.id, result);
    return result;
  };
  let hiddenObjects = 0;
  const counted = new Set<GroupId>();
  const countHidden = (group: Group, hiddenAbove: boolean) => {
    if (counted.has(group.id)) return;
    counted.add(group.id);
    const off = hiddenAbove || group.hidden;
    for (const shape of direct.get(group.id) ?? []) {
      if (off || itemOf(doc, shape.id).hidden) hiddenObjects += 1;
    }
    for (const child of children.get(group.id) ?? []) countHidden(child, off);
  };
  const walk = (
    group: Group,
    depth: number,
    parentKey: string | null,
    hiddenAbove: boolean,
    lockedAbove: boolean,
  ) => {
    if (visited.has(group.id)) return;
    visited.add(group.id);
    const key = groupKey(group.id);
    const open = expanded.has(key);
    const { count, classes: inside } = measure(group);
    const main = dominant(inside);
    const hex = classColour(main);
    rows.push({
      kind: "group",
      key,
      groupId: group.id,
      classKey: null,
      name: group.name,
      colour: colourToCss(group.color) ?? (hex || fallbackColour),
      hex: hexOfRgb(group.color ?? rgbOfHex(hex)),
      count,
      depth,
      hidden: group.hidden,
      locked: group.locked,
      hiddenAbove,
      lockedAbove,
      expanded: open,
      parentKey,
    });
    if (!open) return;
    const off = hiddenAbove || group.hidden;
    const fixed = lockedAbove || group.locked;
    for (const child of children.get(group.id) ?? []) walk(child, depth + 1, key, off, fixed);
    const shapes = [...(direct.get(group.id) ?? [])].sort(sortShapes);
    for (const shape of shapes) rows.push(shapeRow(shape, depth + 1, key, off, fixed));
  };
  for (const root of children.get(null) ?? []) {
    walk(root, 0, null, false, false);
  }
  for (const root of children.get(null) ?? []) countHidden(root, false);
  for (const classKey of looseOrder(loose, context.classes)) {
    const shapes = loose.get(classKey) ?? [];
    const realKey = classKey === "" ? null : classKey;
    const info = realKey === null ? undefined : classes.get(realKey);
    const key = classGroupKey(realKey);
    const open = expanded.has(key);
    for (const shape of shapes) if (itemOf(doc, shape.id).hidden) hiddenObjects += 1;
    rows.push({
      kind: "group",
      key,
      groupId: null,
      classKey: realKey,
      name: info?.name ?? noClassName,
      colour: info?.colour || fallbackColour,
      hex: hexOfRgb(rgbOfHex(info?.colour ?? "")),
      count: shapes.length,
      depth: 0,
      hidden: false,
      locked: false,
      hiddenAbove: false,
      lockedAbove: false,
      expanded: open,
      parentKey: null,
    });
    if (!open) continue;
    for (const shape of [...shapes].sort(sortShapes)) {
      rows.push(shapeRow(shape, 1, key, false, false));
    }
  }
  return { rows, hiddenObjects };
}

function assign(doc: AnnotationDocument, ids: readonly ShapeId[], groupId: GroupId) {
  const shapes = new Map(doc.shapes);
  for (const id of ids) {
    const shape = shapes.get(id);
    if (shape) shapes.set(id, { ...shape, groupId });
  }
  return { ...doc, shapes };
}

export function looseOfClass(doc: AnnotationDocument, classKey: string | null): ShapeId[] {
  const ids: ShapeId[] = [];
  for (const shape of doc.shapes.values()) {
    if (homeOf(doc, shape) === null && shape.classKey === classKey) ids.push(shape.id);
  }
  return ids;
}

export function materialiseClass(
  doc: AnnotationDocument,
  classKey: string | null,
  context: LayerContext,
): { document: AnnotationDocument; groupId: GroupId } | null {
  const ids = looseOfClass(doc, classKey);
  if (ids.length === 0) return null;
  const info = context.classes.find((item) => item.id === classKey);
  const made = addGroup(doc, info?.name ?? noClassName, {
    color: info ? rgbOfHex(info.colour) : null,
  });
  return { document: assign(made.document, ids, made.group.id), groupId: made.group.id };
}

const isPlainItem = (item: LayerItem) =>
  item.name === null && !item.hidden && !item.locked && item.rank === null;

export function setItems(
  doc: AnnotationDocument,
  patches: ReadonlyMap<ShapeId, Partial<LayerItem>>,
): AnnotationDocument {
  if (patches.size === 0) return doc;
  const items = new Map(doc.items);
  for (const [id, patch] of patches) {
    if (!doc.shapes.has(id)) continue;
    const next = { ...itemOf(doc, id), ...patch };
    if (isPlainItem(next)) items.delete(id);
    else items.set(id, next);
  }
  return { ...doc, items };
}

export function renameShape(
  doc: AnnotationDocument,
  id: ShapeId,
  name: string,
): AnnotationDocument {
  const trimmed = name.trim().slice(0, itemNameLimit);
  const current = itemOf(doc, id).name;
  const next = trimmed === "" ? null : trimmed;
  if (!doc.shapes.has(id) || next === current) return doc;
  return setItems(doc, new Map([[id, { name: next }]]));
}

export function toggleShapeHidden(doc: AnnotationDocument, id: ShapeId): AnnotationDocument {
  return setItems(doc, new Map([[id, { hidden: !itemOf(doc, id).hidden }]]));
}

export function toggleShapeLocked(doc: AnnotationDocument, id: ShapeId): AnnotationDocument {
  return setItems(doc, new Map([[id, { locked: !itemOf(doc, id).locked }]]));
}

function subtreeGroups(doc: AnnotationDocument, root: GroupId): Set<GroupId> {
  const { children } = indexOf(doc);
  const found = new Set<GroupId>();
  const stack = [root];
  while (stack.length > 0) {
    const id = stack.pop();
    if (id === undefined || found.has(id)) continue;
    found.add(id);
    for (const child of children.get(id) ?? []) stack.push(child.id);
  }
  return found;
}

export function membersOf(doc: AnnotationDocument, key: string): ShapeId[] {
  const parsed = parseKey(key);
  if (parsed === null) return [];
  if (parsed.kind === "shape") return doc.shapes.has(parsed.id) ? [parsed.id] : [];
  if (parsed.kind === "class") return looseOfClass(doc, parsed.classKey);
  if (!doc.groups.has(parsed.id)) return [];
  const inside = subtreeGroups(doc, parsed.id);
  const ids: ShapeId[] = [];
  for (const shape of doc.shapes.values()) {
    const home = homeOf(doc, shape);
    if (home !== null && inside.has(home)) ids.push(shape.id);
  }
  return ids;
}

export function unionBounds(doc: AnnotationDocument, ids: readonly ShapeId[]): Extent | null {
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const id of ids) {
    const bounds = doc.shapes.get(id)?.bounds;
    if (bounds === undefined) continue;
    left = Math.min(left, bounds[0]);
    top = Math.min(top, bounds[1]);
    right = Math.max(right, bounds[2]);
    bottom = Math.max(bottom, bounds[3]);
  }
  return Number.isFinite(left) ? [left, top, right, bottom] : null;
}

export function openKeysFor(doc: AnnotationDocument, id: ShapeId): string[] {
  const shape = doc.shapes.get(id);
  if (shape === undefined) return [];
  const home = homeOf(doc, shape);
  if (home === null) return [classGroupKey(shape.classKey)];
  return groupChain(doc, home).map((group) => groupKey(group.id));
}

export function rangeOf(rows: readonly TreeRow[], from: string, to: string): ShapeId[] {
  const start = rows.findIndex((row) => row.key === from);
  const end = rows.findIndex((row) => row.key === to);
  if (start < 0 || end < 0) return [];
  const [low, high] = start <= end ? [start, end] : [end, start];
  const ids: ShapeId[] = [];
  for (let index = low; index <= high; index++) {
    const row = rows[index];
    if (row?.kind === "shape") ids.push(row.shapeId);
  }
  return ids;
}

function spread(low: number, high: number, count: number): number[] {
  return Array.from(
    { length: count },
    (_, index) => low + ((high - low) * (index + 1)) / (count + 1),
  );
}

function slotAround<T>(
  siblings: readonly T[],
  orderOf: (item: T) => number,
  target: T | undefined,
  place: DropPlace,
): [number, number] {
  const index = target === undefined ? -1 : siblings.indexOf(target);
  if (index < 0 || place === "into") {
    const last = siblings.at(-1);
    const low = last === undefined ? 0 : orderOf(last);
    return [low, low + siblings.length + 2];
  }
  const here = orderOf(siblings[index] as T);
  if (place === "before") {
    const previous = siblings[index - 1];
    return [previous === undefined ? here - 1 : orderOf(previous), here];
  }
  const next = siblings[index + 1];
  return [here, next === undefined ? here + 1 : orderOf(next)];
}

interface Destination {
  readonly document: AnnotationDocument;
  readonly parent: GroupId | null;
  readonly shapeTarget?: Shape;
  readonly groupTarget?: Group;
}

function destinationOf(
  doc: AnnotationDocument,
  target: DropTarget,
  context: LayerContext,
): Destination | null {
  const parsed = parseKey(target.key);
  if (parsed === null) return null;
  if (parsed.kind === "class") {
    if (target.place !== "into") return { document: doc, parent: null };
    const made = materialiseClass(doc, parsed.classKey, context);
    return made === null
      ? { document: doc, parent: null }
      : { document: made.document, parent: made.groupId };
  }
  if (parsed.kind === "group") {
    const group = doc.groups.get(parsed.id);
    if (group === undefined) return null;
    if (target.place === "into") return { document: doc, parent: group.id };
    return { document: doc, parent: parentOf(doc, group), groupTarget: group };
  }
  const shape = doc.shapes.get(parsed.id);
  if (shape === undefined) return null;
  return { document: doc, parent: homeOf(doc, shape), shapeTarget: shape };
}

export function dropRows(
  doc: AnnotationDocument,
  dragged: readonly string[],
  target: DropTarget,
  context: LayerContext,
): AnnotationDocument {
  if (dragged.includes(target.key)) return doc;
  const keys = dragged.map(parseKey);
  const draggedGroups = keys.flatMap((key) =>
    key?.kind === "group" && doc.groups.has(key.id) ? [key.id] : [],
  );
  const draggedShapes = keys.flatMap((key) =>
    key?.kind === "shape" && doc.shapes.has(key.id) ? [key.id] : [],
  );
  if (draggedGroups.length + draggedShapes.length === 0) return doc;
  const place = target.place === "into" && target.key.startsWith("s:") ? "after" : target.place;
  const found = destinationOf(doc, { key: target.key, place }, context);
  if (found === null) return doc;
  const { parent } = found;
  if (parent !== null && usableTarget(found.document, parent) === null) return doc;
  if (parent !== null) {
    const chain = groupChain(found.document, parent).map((group) => group.id);
    if (draggedGroups.some((id) => chain.includes(id))) return doc;
  }
  let next = found.document;
  if (draggedGroups.length > 0) {
    const moving = new Set(draggedGroups);
    const siblings = [...next.groups.values()]
      .filter((group) => parentOf(next, group) === parent && !moving.has(group.id))
      .sort(byGroupOrder);
    const [low, high] = slotAround(siblings, groupOrder, found.groupTarget, place);
    const ordered = draggedGroups
      .map((id) => next.groups.get(id))
      .filter((group): group is Group => group !== undefined)
      .sort(byGroupOrder);
    const ranks = spread(low, high, ordered.length);
    ordered.forEach((group, index) => {
      next = updateGroup(next, group.id, { parentId: parent, rank: ranks[index] ?? 0 }).document;
    });
  }
  if (draggedShapes.length > 0) {
    const moving = new Set(draggedShapes);
    const before = next;
    const sameBucket = (shape: Shape) =>
      parent !== null || found.shapeTarget === undefined
        ? true
        : shape.classKey === found.shapeTarget.classKey;
    const siblings = [...before.shapes.values()]
      .filter(
        (shape) => homeOf(before, shape) === parent && !moving.has(shape.id) && sameBucket(shape),
      )
      .sort(byShapeOrder(before));
    const [low, high] = slotAround(
      siblings,
      (shape) => shapeOrder(before, shape),
      found.shapeTarget,
      place,
    );
    const ordered = draggedShapes
      .map((id) => before.shapes.get(id))
      .filter((shape): shape is Shape => shape !== undefined)
      .sort(byShapeOrder(before));
    const ranks = spread(low, high, ordered.length);
    next = moveToGroup(
      next,
      ordered.map((shape) => shape.id),
      parent,
    );
    next = setItems(
      next,
      new Map(ordered.map((shape, index) => [shape.id, { rank: ranks[index] ?? 0 }])),
    );
  }
  return next;
}
