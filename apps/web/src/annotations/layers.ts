import {
  type AnnotationDocument,
  addGroup,
  type Group,
  groupChain,
  removeGroup,
  updateGroup,
} from "./document.ts";
import { centreOf, type Extent, type GroupId, type Shape, type ShapeId } from "./shapes.ts";

export const layerLenses = ["class", "cluster", "region", "source"] as const;

export type LayerLens = (typeof layerLenses)[number];

export const clusterGapPx = 256;

export const ungroupedKey = "ungrouped";

export interface LayerClass {
  readonly id: string;
  readonly name: string;
  readonly colour: string;
}

export interface LayerRegion {
  readonly name: string;
  readonly extent: Extent;
}

export interface LayerContext {
  readonly classes: readonly LayerClass[];
  readonly regions: readonly LayerRegion[];
}

export interface LayerRow {
  readonly key: string;
  readonly groupId: GroupId | null;
  readonly name: string;
  readonly colour: string;
  readonly count: number;
  readonly depth: number;
  readonly hidden: boolean;
  readonly locked: boolean;
  readonly hiddenAbove: boolean;
  readonly lockedAbove: boolean;
  readonly hasChildren: boolean;
}

export interface Bucket {
  readonly key: string;
  readonly name: string;
  readonly colour: readonly [number, number, number] | null;
  readonly ids: readonly ShapeId[];
}

const fallbackColour = "var(--fg-faint)";

export function colourToCss(color: readonly [number, number, number] | null): string | null {
  return color === null ? null : `rgb(${color[0]} ${color[1]} ${color[2]})`;
}

export function rgbOfHex(hex: string): [number, number, number] | null {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (match === null) return null;
  const value = Number.parseInt(match[1] ?? "0", 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

export function hexOfRgb(color: readonly [number, number, number] | null): string {
  if (color === null) return "#888888";
  return `#${color.map((part) => part.toString(16).padStart(2, "0")).join("")}`;
}

function dominantClass(shapes: readonly Shape[]): string | null {
  const counts = new Map<string, number>();
  for (const shape of shapes) {
    if (shape.classKey !== null) counts.set(shape.classKey, (counts.get(shape.classKey) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [key, count] of counts) {
    if (count > bestCount) {
      best = key;
      bestCount = count;
    }
  }
  return best;
}

function childrenOf(doc: AnnotationDocument, parent: GroupId | null): Group[] {
  return [...doc.groups.values()]
    .filter((group) =>
      parent === null
        ? group.parentId === null || !doc.groups.has(group.parentId)
        : group.parentId === parent,
    )
    .sort((a, b) => a.id - b.id);
}

export function layerRows(doc: AnnotationDocument, context: LayerContext): LayerRow[] {
  const direct = new Map<GroupId | null, Shape[]>();
  for (const shape of doc.shapes.values()) {
    const key = shape.groupId !== null && doc.groups.has(shape.groupId) ? shape.groupId : null;
    direct.set(key, [...(direct.get(key) ?? []), shape]);
  }
  const rows: LayerRow[] = [];
  const subtree = (group: Group): Shape[] => [
    ...(direct.get(group.id) ?? []),
    ...childrenOf(doc, group.id).flatMap(subtree),
  ];
  const walk = (group: Group, depth: number, hiddenAbove: boolean, lockedAbove: boolean) => {
    const shapes = subtree(group);
    const children = childrenOf(doc, group.id);
    const dominant = dominantClass(shapes);
    const classColour = context.classes.find((item) => item.id === dominant)?.colour;
    rows.push({
      key: String(group.id),
      groupId: group.id,
      name: group.name,
      colour: colourToCss(group.color) ?? classColour ?? fallbackColour,
      count: shapes.length,
      depth,
      hidden: group.hidden,
      locked: group.locked,
      hiddenAbove,
      lockedAbove,
      hasChildren: children.length > 0,
    });
    for (const child of children) {
      walk(child, depth + 1, hiddenAbove || group.hidden, lockedAbove || group.locked);
    }
  };
  for (const root of childrenOf(doc, null)) walk(root, 0, false, false);
  const loose = direct.get(null) ?? [];
  if (loose.length > 0) {
    rows.push({
      key: ungroupedKey,
      groupId: null,
      name: "Ungrouped",
      colour: fallbackColour,
      count: loose.length,
      depth: 0,
      hidden: false,
      locked: false,
      hiddenAbove: false,
      lockedAbove: false,
      hasChildren: false,
    });
  }
  return rows;
}

function assignGroup(
  doc: AnnotationDocument,
  ids: readonly ShapeId[],
  groupId: GroupId,
): AnnotationDocument {
  const shapes = new Map(doc.shapes);
  for (const id of ids) {
    const shape = shapes.get(id);
    if (shape) shapes.set(id, { ...shape, groupId });
  }
  return { ...doc, shapes };
}

export function usableTarget(doc: AnnotationDocument, target: GroupId | null): GroupId | null {
  if (target === null) return null;
  const chain = groupChain(doc, target);
  if (chain.length === 0 || chain[0]?.id !== target) return null;
  return chain.some((group) => group.hidden || group.locked) ? null : target;
}

export function intoGroup(
  before: AnnotationDocument,
  after: AnnotationDocument,
  target: GroupId | null,
): AnnotationDocument {
  const home = usableTarget(after, target);
  if (home === null || after === before) return after;
  const fresh = [...after.shapes.values()]
    .filter((shape) => shape.id >= before.nextShapeId && shape.groupId === null)
    .map((shape) => shape.id);
  return fresh.length === 0 ? after : assignGroup(after, fresh, home);
}

export function groupShapes(
  doc: AnnotationDocument,
  ids: readonly ShapeId[],
  name?: string,
): { document: AnnotationDocument; group: Group } | null {
  const members = [...new Set(ids)]
    .map((id) => doc.shapes.get(id))
    .filter((shape): shape is Shape => shape !== undefined);
  if (members.length === 0) return null;
  const homes = new Set(members.map((shape) => shape.groupId));
  const only = homes.size === 1 ? (members[0]?.groupId ?? null) : null;
  const parentId = only !== null && doc.groups.has(only) ? only : null;
  const made = addGroup(doc, name ?? `Group ${doc.nextGroupId}`, { parentId });
  const document = assignGroup(
    made.document,
    members.map((shape) => shape.id),
    made.group.id,
  );
  return { document, group: made.group };
}

export function ungroupShapes(
  doc: AnnotationDocument,
  ids: readonly ShapeId[],
): AnnotationDocument {
  const groups = new Set<GroupId>();
  for (const id of ids) {
    const groupId = doc.shapes.get(id)?.groupId;
    if (groupId !== null && groupId !== undefined && doc.groups.has(groupId)) groups.add(groupId);
  }
  let document = doc;
  for (const groupId of groups) document = removeGroup(document, groupId);
  return document;
}

export function addLayer(
  doc: AnnotationDocument,
  parentId: GroupId | null,
): { document: AnnotationDocument; group: Group } {
  return addGroup(doc, `Layer ${doc.nextGroupId}`, { parentId });
}

export function toggleHidden(doc: AnnotationDocument, id: GroupId): AnnotationDocument {
  const group = doc.groups.get(id);
  return group === undefined ? doc : updateGroup(doc, id, { hidden: !group.hidden }).document;
}

export function toggleLocked(doc: AnnotationDocument, id: GroupId): AnnotationDocument {
  const group = doc.groups.get(id);
  return group === undefined ? doc : updateGroup(doc, id, { locked: !group.locked }).document;
}

export function setOverlaysHidden(doc: AnnotationDocument, hidden: boolean): AnnotationDocument {
  let next = doc;
  const loose = [...doc.shapes.values()]
    .filter((shape) => shape.groupId === null || !doc.groups.has(shape.groupId))
    .map((shape) => shape.id);
  if (hidden && loose.length > 0) {
    const made = addGroup(next, "Ungrouped");
    next = assignGroup(made.document, loose, made.group.id);
  }
  for (const group of childrenOf(next, null)) {
    if (group.hidden !== hidden) next = updateGroup(next, group.id, { hidden }).document;
  }
  return next;
}

export function overlaysHidden(doc: AnnotationDocument): boolean {
  const roots = childrenOf(doc, null);
  return roots.length > 0 && roots.every((group) => group.hidden);
}

function centreOfShape(shape: Shape): { x: number; y: number } {
  const [x, y] = centreOf(shape.bounds);
  return { x, y };
}

function clusterBuckets(shapes: readonly Shape[]): Bucket[] {
  const parent = shapes.map((_, index) => index);
  const find = (index: number): number => {
    let root = index;
    while (parent[root] !== root) root = parent[root] ?? root;
    let walk = index;
    while (parent[walk] !== root) {
      const next = parent[walk] ?? root;
      parent[walk] = root;
      walk = next;
    }
    return root;
  };
  const cells = new Map<string, number[]>();
  const centres = shapes.map(centreOfShape);
  const cellOf = (value: number) => Math.floor(value / clusterGapPx);
  centres.forEach((centre, index) => {
    const cx = cellOf(centre.x);
    const cy = cellOf(centre.y);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const other of cells.get(`${cx + dx},${cy + dy}`) ?? []) {
          const near = centres[other];
          if (near && Math.hypot(near.x - centre.x, near.y - centre.y) <= clusterGapPx) {
            parent[find(index)] = find(other);
          }
        }
      }
    }
    const key = `${cx},${cy}`;
    cells.set(key, [...(cells.get(key) ?? []), index]);
  });
  const groups = new Map<number, ShapeId[]>();
  shapes.forEach((shape, index) => {
    const root = find(index);
    groups.set(root, [...(groups.get(root) ?? []), shape.id]);
  });
  return [...groups.values()]
    .sort((a, b) => b.length - a.length || (a[0] ?? 0) - (b[0] ?? 0))
    .map((ids, index) => ({
      key: `cluster:${index + 1}`,
      name: `Cluster ${index + 1}`,
      colour: null,
      ids,
    }));
}

function keyedBuckets(
  shapes: readonly Shape[],
  describe: (shape: Shape) => { key: string; name: string; colour: Bucket["colour"] },
): Bucket[] {
  const found = new Map<string, { name: string; colour: Bucket["colour"]; ids: ShapeId[] }>();
  for (const shape of shapes) {
    const label = describe(shape);
    const entry = found.get(label.key) ?? { name: label.name, colour: label.colour, ids: [] };
    entry.ids.push(shape.id);
    found.set(label.key, entry);
  }
  return [...found].map(([key, entry]) => ({ key, ...entry }));
}

export function bucketsOf(
  doc: AnnotationDocument,
  lens: LayerLens,
  context: LayerContext,
): Bucket[] {
  const loose = [...doc.shapes.values()].filter(
    (shape) => shape.groupId === null || !doc.groups.has(shape.groupId),
  );
  if (lens === "cluster") return clusterBuckets(loose);
  if (lens === "class") {
    return keyedBuckets(loose, (shape) => {
      const info = context.classes.find((item) => item.id === shape.classKey);
      return {
        key: `class:${shape.classKey ?? ""}`,
        name: info?.name ?? "No class",
        colour: info ? rgbOfHex(info.colour) : null,
      };
    });
  }
  if (lens === "source") {
    return keyedBuckets(loose, (shape) =>
      shape.provenance.kind === "human"
        ? { key: "source:human", name: "Drawn by hand", colour: null }
        : {
            key: `source:${shape.provenance.model}:${shape.provenance.version ?? ""}`,
            name: `${shape.provenance.model}${shape.provenance.version ? ` ${shape.provenance.version}` : ""}`,
            colour: null,
          },
    );
  }
  return keyedBuckets(loose, (shape) => {
    const centre = centreOfShape(shape);
    const region = context.regions.find(
      (item) =>
        centre.x >= item.extent[0] &&
        centre.x <= item.extent[2] &&
        centre.y >= item.extent[1] &&
        centre.y <= item.extent[3],
    );
    return region
      ? { key: `region:${region.name}`, name: region.name, colour: null }
      : { key: "region:none", name: "Outside the areas", colour: null };
  });
}

export function groupBy(
  doc: AnnotationDocument,
  lens: LayerLens,
  context: LayerContext,
): AnnotationDocument {
  let document = doc;
  for (const bucket of bucketsOf(doc, lens, context)) {
    const existing = [...document.groups.values()].find(
      (group) =>
        group.parentId === null && group.name === bucket.name && !group.hidden && !group.locked,
    );
    let groupId: GroupId;
    if (existing) {
      groupId = existing.id;
    } else {
      const made = addGroup(document, bucket.name, { color: bucket.colour });
      document = made.document;
      groupId = made.group.id;
    }
    document = assignGroup(document, bucket.ids, groupId);
  }
  return document;
}
