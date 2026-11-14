export type Placement = {
  readonly dx: number;
  readonly dy: number;
  readonly scale: number;
};

export const noPlacement: Placement = { dx: 0, dy: 0, scale: 1 };

export const isUnplaced = (placement: Placement) =>
  placement.dx === 0 && placement.dy === 0 && placement.scale === 1;

export type PreviewShape =
  | { readonly id: number; readonly kind: "ring"; readonly points: readonly number[] }
  | { readonly id: number; readonly kind: "point"; readonly x: number; readonly y: number };

export type ParsedResults = {
  readonly shapes: readonly PreviewShape[];
  readonly objects: number;
};

type Json = unknown;

const isRecord = (value: Json): value is Record<string, Json> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isPosition = (value: Json): value is number[] =>
  Array.isArray(value) &&
  value.length >= 2 &&
  typeof value[0] === "number" &&
  typeof value[1] === "number";

const ringOf = (positions: Json): number[] | null => {
  if (!Array.isArray(positions)) return null;
  const flat: number[] = [];
  for (const position of positions) {
    if (!isPosition(position)) return null;
    flat.push(position[0] ?? 0, position[1] ?? 0);
  }
  return flat.length >= 6 ? flat : null;
};

const geometriesOf = (node: Json): Record<string, Json>[] => {
  if (!isRecord(node)) return [];
  if (node["type"] === "FeatureCollection" && Array.isArray(node["features"]))
    return node["features"].flatMap(geometriesOf);
  if (node["type"] === "Feature") return geometriesOf(node["geometry"]);
  if (node["type"] === "GeometryCollection" && Array.isArray(node["geometries"]))
    return node["geometries"].flatMap(geometriesOf);
  return typeof node["type"] === "string" ? [node] : [];
};

type Bare<T> = T extends unknown ? Omit<T, "id"> : never;

const shapesOf = (geometry: Record<string, Json>): Bare<PreviewShape>[] => {
  const coordinates = geometry["coordinates"];
  if (!Array.isArray(coordinates)) return [];
  if (geometry["type"] === "Point" && isPosition(coordinates))
    return [{ kind: "point", x: coordinates[0] ?? 0, y: coordinates[1] ?? 0 }];
  if (geometry["type"] === "MultiPoint")
    return coordinates
      .filter(isPosition)
      .map((p) => ({ kind: "point", x: p[0] ?? 0, y: p[1] ?? 0 }));
  if (geometry["type"] === "Polygon") {
    const outer = ringOf(coordinates[0]);
    return outer === null ? [] : [{ kind: "ring", points: outer }];
  }
  if (geometry["type"] === "MultiPolygon")
    return coordinates.flatMap((polygon) => {
      const outer = ringOf(Array.isArray(polygon) ? polygon[0] : null);
      return outer === null ? [] : [{ kind: "ring" as const, points: outer }];
    });
  return [];
};

export const parseResults = (text: string): ParsedResults | null => {
  let document: Json;
  try {
    document = JSON.parse(text);
  } catch {
    return null;
  }
  const geometries = geometriesOf(document);
  if (geometries.length === 0) return null;
  const shapes = geometries.flatMap(shapesOf).map((shape, id): PreviewShape => ({ ...shape, id }));
  return shapes.length === 0 ? null : { shapes, objects: geometries.length };
};

export const placePoint = (placement: Placement, x: number, y: number) => ({
  x: x * placement.scale + placement.dx,
  y: y * placement.scale + placement.dy,
});

const placeCoordinates = (placement: Placement, node: Json): Json => {
  if (isPosition(node)) {
    const moved = placePoint(placement, node[0] ?? 0, node[1] ?? 0);
    return [moved.x, moved.y, ...node.slice(2)];
  }
  return Array.isArray(node) ? node.map((child) => placeCoordinates(placement, child)) : node;
};

const placeNode = (placement: Placement, node: Json): Json => {
  if (Array.isArray(node)) return node.map((child) => placeNode(placement, child));
  if (!isRecord(node)) return node;
  const out: Record<string, Json> = {};
  for (const [key, value] of Object.entries(node))
    out[key] =
      key === "coordinates" ? placeCoordinates(placement, value) : placeNode(placement, value);
  return out;
};

export const placedText = (text: string, placement: Placement): string =>
  JSON.stringify(placeNode(placement, JSON.parse(text)));
