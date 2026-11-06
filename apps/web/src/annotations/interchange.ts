import {
  type AnnotationDocument,
  addGroup,
  addRestoredShape,
  type Group,
  listShapes,
  placePin,
} from "./document.ts";
import { type History, record } from "./history.ts";
import {
  at,
  type GroupId,
  outlineOf,
  type Provenance,
  type ReviewState,
  reviewStates,
  type Shape,
  type ShapeId,
  type ShapeKind,
  shapeKinds,
} from "./shapes.ts";

export const ownFormat = "parfocal-annotations";
export const ownVersion = 1;

type Json = Record<string, unknown>;
type Ring = [number, number][];

export interface FileGroup {
  readonly key: number;
  readonly name: string;
  readonly parentKey: number | null;
  readonly color: readonly [number, number, number] | null;
  readonly hidden: boolean;
  readonly locked: boolean;
}

export interface FileShape {
  readonly key: number | null;
  readonly kind: ShapeKind;
  readonly points: Float32Array;
  readonly ringStarts: Uint32Array;
  readonly className: string | null;
  readonly groupKey: number | null;
  readonly text: string | null;
  readonly reviewState: ReviewState;
  readonly threadIds: readonly string[];
  readonly provenance: Provenance;
}

export interface FilePin {
  readonly threadId: string;
  readonly shapeKey: number | null;
  readonly offset: { readonly x: number; readonly y: number };
}

export interface Skipped {
  readonly index: number;
  readonly reason: string;
}

export interface ReadFile {
  readonly groups: readonly FileGroup[];
  readonly shapes: readonly FileShape[];
  readonly pins: readonly FilePin[];
  readonly skipped: readonly Skipped[];
}

export interface ClassNames {
  readonly nameOf: (classKey: string) => string;
  readonly keyOf: (name: string) => string | null;
}

export const sameClassNames: ClassNames = { nameOf: (key) => key, keyOf: (name) => name };

export class UnreadableFileError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "UnreadableFileError";
  }
}

const layerKinds: Partial<Record<ShapeKind, string>> = {
  polygon: "region",
  freehand: "region",
  rectangle: "region",
  ellipse: "region",
  brush: "region",
  point: "cell",
  ruler: "measurement",
};

const isJson = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const textOf = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value : null;

const numberOf = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

function ringsOf(shape: Shape): Ring[] {
  const rings: Ring[] = [];
  for (let ring = 0; ring + 1 < shape.ringStarts.length; ring++) {
    const out: Ring = [];
    for (
      let vertex = at(shape.ringStarts, ring);
      vertex < at(shape.ringStarts, ring + 1);
      vertex++
    ) {
      out.push([at(shape.points, vertex * 2), at(shape.points, vertex * 2 + 1)]);
    }
    rings.push(out);
  }
  return rings;
}

const closed = (ring: Ring): Ring => {
  const first = ring[0];
  return first === undefined ? ring : [...ring, [first[0], first[1]]];
};

function outlineRing(shape: Shape): Ring {
  const outline = outlineOf(shape);
  const ring: Ring = [];
  for (let index = 0; index + 1 < outline.length; index += 2) {
    ring.push([at(outline, index), at(outline, index + 1)]);
  }
  return closed(ring);
}

export function geometryOf(shape: Shape): Json {
  const rings = ringsOf(shape);
  const first = rings[0] ?? [];
  switch (shape.kind) {
    case "point":
    case "text":
      return { type: "Point", coordinates: first[0] ?? [0, 0] };
    case "ruler":
    case "arrow":
      return { type: "LineString", coordinates: first };
    case "brush":
      return { type: "MultiPolygon", coordinates: rings.map((ring) => [closed(ring)]) };
    case "polygon":
    case "freehand":
    case "rectangle":
    case "ellipse":
      return { type: "Polygon", coordinates: [outlineRing(shape)] };
  }
}

function ownDetails(shape: Shape, names: ClassNames): Json {
  return {
    id: shape.id,
    shape: shape.kind,
    points: Array.from(shape.points),
    ring_starts: Array.from(shape.ringStarts),
    group: shape.groupId,
    text: shape.text,
    review_state: shape.reviewState,
    threads: [...shape.threadIds],
    provenance: shape.provenance,
    ...(shape.classKey === null ? {} : { class: names.nameOf(shape.classKey) }),
  };
}

function groupsOf(doc: AnnotationDocument): Json[] {
  return [...doc.groups.values()].map((group) => ({
    id: group.id,
    name: group.name,
    parent: group.parentId,
    color: group.color,
    hidden: group.hidden,
    locked: group.locked,
  }));
}

function pinsOf(doc: AnnotationDocument): Json[] {
  return [...doc.pins.entries()].map(([thread, pin]) => ({
    thread,
    shape: pin.shapeId,
    offset: { x: pin.offset.x, y: pin.offset.y },
  }));
}

export function toOwnJson(doc: AnnotationDocument, names: ClassNames = sameClassNames): Json {
  return {
    format: ownFormat,
    version: ownVersion,
    groups: groupsOf(doc),
    pins: pinsOf(doc),
    objects: listShapes(doc).map((shape) => {
      const kind = layerKinds[shape.kind];
      return {
        ...ownDetails(shape, names),
        ...(kind === undefined ? {} : { kind }),
        geometry: geometryOf(shape),
      };
    }),
  };
}

export function toGeoJson(doc: AnnotationDocument, names: ClassNames = sameClassNames): Json {
  return {
    type: "FeatureCollection",
    parfocal: { format: ownFormat, version: ownVersion, groups: groupsOf(doc), pins: pinsOf(doc) },
    features: listShapes(doc).map((shape) => ({
      type: "Feature",
      id: String(shape.id),
      geometry: geometryOf(shape),
      properties: {
        objectType: shape.kind === "point" ? "detection" : "annotation",
        ...(shape.classKey === null
          ? {}
          : { classification: { name: names.nameOf(shape.classKey) } }),
        ...(shape.text === null ? {} : { name: shape.text }),
        parfocal: ownDetails(shape, names),
      },
    })),
  };
}

const openRing = (ring: unknown): [number, number][] | null => {
  if (!Array.isArray(ring)) return null;
  const out: [number, number][] = [];
  for (const position of ring) {
    if (!Array.isArray(position)) return null;
    const x = numberOf(position[0]);
    const y = numberOf(position[1]);
    if (x === null || y === null) return null;
    out.push([x, y]);
  }
  const first = out[0];
  const last = out.at(-1);
  if (out.length > 1 && first && last && first[0] === last[0] && first[1] === last[1]) out.pop();
  return out;
};

interface Plain {
  readonly kind: ShapeKind;
  readonly rings: [number, number][][];
}

function plainShapes(geometry: unknown): Plain[] | string {
  if (!isJson(geometry)) return "It has no geometry";
  const coordinates = geometry["coordinates"];
  const many = Array.isArray(coordinates) ? coordinates : [];
  switch (geometry["type"]) {
    case "Point": {
      const ring = openRing([coordinates]);
      return ring ? [{ kind: "point", rings: [ring] }] : "A point needs x and y";
    }
    case "MultiPoint": {
      const ring = openRing(coordinates);
      return ring ? ring.map((position) => ({ kind: "point", rings: [[position]] })) : "Bad points";
    }
    case "LineString": {
      const ring = openRing(coordinates);
      return ring && ring.length === 2
        ? [{ kind: "ruler", rings: [ring] }]
        : "Only two-point lines";
    }
    case "Polygon":
      return polygonShape(many);
    case "MultiPolygon": {
      const shapes: Plain[] = [];
      for (const polygon of many) {
        const shape = polygonShape(Array.isArray(polygon) ? polygon : []);
        if (typeof shape === "string") return shape;
        shapes.push(...shape);
      }
      return shapes;
    }
    default:
      return `A ${String(geometry["type"])} cannot be read`;
  }
}

function polygonShape(rings: unknown[]): Plain[] | string {
  const read = rings.map(openRing);
  if (read.length === 0 || read.some((ring) => ring === null || ring.length < 3)) {
    return "A polygon needs rings of three points or more";
  }
  const valid = read as [number, number][][];
  return [{ kind: valid.length === 1 ? "polygon" : "brush", rings: valid }];
}

function packed(rings: readonly (readonly [number, number])[][]): {
  points: Float32Array;
  ringStarts: Uint32Array;
} {
  const starts = [0];
  const flat: number[] = [];
  for (const ring of rings) {
    for (const [x, y] of ring) flat.push(x, y);
    starts.push(flat.length / 2);
  }
  return { points: Float32Array.from(flat), ringStarts: Uint32Array.from(starts) };
}

const isKind = (value: unknown): value is ShapeKind =>
  typeof value === "string" && (shapeKinds as readonly string[]).includes(value);

const isReviewState = (value: unknown): value is ReviewState =>
  typeof value === "string" && (reviewStates as readonly string[]).includes(value);

function provenanceOf(value: unknown): Provenance {
  if (!isJson(value) || value["kind"] !== "model") return { kind: "human" };
  return {
    kind: "model",
    model: textOf(value["model"]) ?? "Model",
    version: textOf(value["version"]),
    runId: numberOf(value["runId"]) ?? 0,
    piece: numberOf(value["piece"]) ?? 0,
    confidence: numberOf(value["confidence"]),
    edited: value["edited"] === true,
  };
}

function ownShape(details: Json, className: string | null): FileShape | null {
  const points = details["points"];
  const starts = details["ring_starts"];
  if (!isKind(details["shape"]) || !Array.isArray(points) || !Array.isArray(starts)) return null;
  if (!points.every((value) => numberOf(value) !== null)) return null;
  if (!starts.every((value) => numberOf(value) !== null)) return null;
  const threads = details["threads"];
  return {
    key: numberOf(details["id"]),
    kind: details["shape"],
    points: Float32Array.from(points as number[]),
    ringStarts: Uint32Array.from(starts as number[]),
    className: textOf(details["class"]) ?? className,
    groupKey: numberOf(details["group"]),
    text: textOf(details["text"]),
    reviewState: isReviewState(details["review_state"]) ? details["review_state"] : "unreviewed",
    threadIds: Array.isArray(threads)
      ? threads.filter((t): t is string => typeof t === "string")
      : [],
    provenance: provenanceOf(details["provenance"]),
  };
}

function plainFileShapes(plain: Plain[], className: string | null): FileShape[] {
  return plain.map((shape) => ({
    key: null,
    ...packed(shape.rings),
    kind: shape.kind,
    className,
    groupKey: null,
    text: null,
    reviewState: "unreviewed",
    threadIds: [],
    provenance: { kind: "human" },
  }));
}

function classNameOf(properties: Json): string | null {
  const classification = properties["classification"];
  if (isJson(classification)) return textOf(classification["name"]);
  return textOf(classification) ?? textOf(properties["class"]);
}

function featureShapes(feature: unknown, index: number, skipped: Skipped[]): FileShape[] {
  if (!isJson(feature)) {
    skipped.push({ index, reason: "It is not a feature" });
    return [];
  }
  const properties = isJson(feature["properties"]) ? feature["properties"] : {};
  const className = classNameOf(properties);
  const details = properties["parfocal"];
  const own = isJson(details) ? ownShape(details, className) : null;
  if (own) return [own];
  const plain = plainShapes(feature["geometry"]);
  if (typeof plain === "string") {
    skipped.push({ index, reason: plain });
    return [];
  }
  return plainFileShapes(plain, className);
}

function objectShapes(item: unknown, index: number, skipped: Skipped[]): FileShape[] {
  if (!isJson(item)) {
    skipped.push({ index, reason: "It is not an object" });
    return [];
  }
  const className = textOf(item["class"]);
  const own = ownShape(item, className);
  if (own) return [own];
  const plain = plainShapes(item["geometry"]);
  if (typeof plain === "string") {
    skipped.push({ index, reason: plain });
    return [];
  }
  return plainFileShapes(plain, className);
}

function fileGroups(value: unknown): FileGroup[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): FileGroup[] => {
    if (!isJson(item)) return [];
    const key = numberOf(item["id"]);
    if (key === null) return [];
    const color = item["color"];
    const rgb =
      Array.isArray(color) && color.length === 3 && color.every((c) => numberOf(c) !== null)
        ? ([color[0], color[1], color[2]] as [number, number, number])
        : null;
    return [
      {
        key,
        name: textOf(item["name"]) ?? `Group ${key}`,
        parentKey: numberOf(item["parent"]),
        color: rgb,
        hidden: item["hidden"] === true,
        locked: item["locked"] === true,
      },
    ];
  });
}

function filePins(value: unknown): FilePin[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): FilePin[] => {
    if (!isJson(item) || !isJson(item["offset"])) return [];
    const threadId = textOf(item["thread"]);
    const x = numberOf(item["offset"]["x"]);
    const y = numberOf(item["offset"]["y"]);
    if (threadId === null || x === null || y === null) return [];
    return [{ threadId, shapeKey: numberOf(item["shape"]), offset: { x, y } }];
  });
}

export function readFile(text: string): ReadFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new UnreadableFileError("The file is not JSON");
  }
  const skipped: Skipped[] = [];
  if (Array.isArray(parsed)) {
    const shapes = parsed.flatMap((item, index) => featureShapes(item, index, skipped));
    return { groups: [], shapes, pins: [], skipped };
  }
  if (!isJson(parsed))
    throw new UnreadableFileError("The file is not GeoJSON or a Parfocal export");
  const objects = parsed["objects"];
  if (typeof parsed["format"] === "string" && parsed["format"].startsWith("parfocal-")) {
    if (!Array.isArray(objects)) throw new UnreadableFileError("The export lists no objects");
    return {
      groups: fileGroups(parsed["groups"]),
      shapes: objects.flatMap((item, index) => objectShapes(item, index, skipped)),
      pins: filePins(parsed["pins"]),
      skipped,
    };
  }
  const features = parsed["features"];
  if (parsed["type"] === "FeatureCollection" && Array.isArray(features)) {
    const own = isJson(parsed["parfocal"]) ? parsed["parfocal"] : {};
    return {
      groups: fileGroups(own["groups"]),
      shapes: features.flatMap((item, index) => featureShapes(item, index, skipped)),
      pins: filePins(own["pins"]),
      skipped,
    };
  }
  if (parsed["type"] === "Feature") {
    return { groups: [], shapes: featureShapes(parsed, 0, skipped), pins: [], skipped };
  }
  throw new UnreadableFileError("The file is not GeoJSON or a Parfocal export");
}

export interface Merged {
  readonly document: AnnotationDocument;
  readonly group: Group;
  readonly added: readonly ShapeId[];
  readonly skipped: readonly Skipped[];
}

function groupOrder(groups: readonly FileGroup[]): FileGroup[] {
  const keys = new Set(groups.map((group) => group.key));
  const placed = new Set<number>();
  const ordered: FileGroup[] = [];
  let pending = [...groups];
  while (pending.length > 0) {
    const ready = pending.filter(
      (group) =>
        group.parentKey === null || !keys.has(group.parentKey) || placed.has(group.parentKey),
    );
    const next = ready.length > 0 ? ready : pending.slice(0, 1);
    for (const group of next) {
      ordered.push(group);
      placed.add(group.key);
    }
    pending = pending.filter((group) => !placed.has(group.key));
  }
  return ordered;
}

export function mergeFile(
  doc: AnnotationDocument,
  file: ReadFile,
  fileName: string,
  names: ClassNames = sameClassNames,
): Merged {
  if (file.shapes.length === 0 && file.groups.length === 0) {
    throw new UnreadableFileError("The file holds no shapes");
  }
  const top = addGroup(doc, fileName);
  let next = top.document;
  const groupIds = new Map<number, GroupId>();
  for (const group of groupOrder(file.groups)) {
    const parentId =
      group.parentKey === null ? top.group.id : (groupIds.get(group.parentKey) ?? top.group.id);
    const made = addGroup(next, group.name, {
      parentId,
      color: group.color,
      hidden: group.hidden,
      locked: group.locked,
    });
    next = made.document;
    groupIds.set(group.key, made.group.id);
  }
  const shapeIds = new Map<number, ShapeId>();
  const added: ShapeId[] = [];
  const skipped: Skipped[] = [...file.skipped];
  file.shapes.forEach((shape, index) => {
    try {
      const made = addRestoredShape(
        next,
        {
          kind: shape.kind,
          points: shape.points,
          ringStarts: shape.ringStarts,
          classKey: shape.className === null ? null : names.keyOf(shape.className),
          groupId:
            shape.groupKey === null ? top.group.id : (groupIds.get(shape.groupKey) ?? top.group.id),
          text: shape.text,
          reviewState: shape.reviewState,
        },
        shape.provenance,
        shape.threadIds,
      );
      next = made.document;
      added.push(made.shape.id);
      if (shape.key !== null) shapeIds.set(shape.key, made.shape.id);
    } catch (error) {
      skipped.push({ index, reason: error instanceof Error ? error.message : String(error) });
    }
  });
  for (const pin of file.pins) {
    if (next.pins.has(pin.threadId)) continue;
    const shapeId = pin.shapeKey === null ? null : (shapeIds.get(pin.shapeKey) ?? null);
    if (pin.shapeKey !== null && shapeId === null) continue;
    next = placePin(next, pin.threadId, { shapeId, offset: pin.offset });
  }
  return { document: next, group: top.group, added, skipped };
}

export interface Imported extends Merged {
  readonly history: History;
}

export function importFile(
  doc: AnnotationDocument,
  history: History,
  text: string,
  fileName: string,
  names: ClassNames = sameClassNames,
): Imported {
  const merged = mergeFile(doc, readFile(text), fileName, names);
  const recorded = record(history, doc, merged.document, `Import ${fileName}`);
  return { ...merged, history: recorded.history };
}
