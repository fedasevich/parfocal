import type { Layer } from "@deck.gl/core";
import { PathStyleExtension } from "@deck.gl/extensions";
import {
  BitmapLayer,
  IconLayer,
  PathLayer,
  ScatterplotLayer,
  SolidPolygonLayer,
  TextLayer,
} from "@deck.gl/layers";
import type { OverlayLayer } from "../../engine/types.ts";
import {
  buildCullGrid,
  type CellRect,
  type CullGrid,
  cellsKey,
  cullWindow,
  pointSubset,
  polygonSubset,
  sameCells,
  triangleStarts,
  type ViewRect,
  windowMembers,
} from "../cull-grid.ts";
import {
  chooseLod,
  densityRaster,
  fullDetail,
  type LodChoice,
  type LodStats,
  largeShapes,
  lodKey,
  lodLargeFactor,
  lodStats,
  smallShapeCentres,
  smallShapeIds,
} from "../lod.ts";
import { nearBlack, white } from "../outline-style.ts";
import { isLabelOverlay, isOverlayDescription, isPinOverlay, isRasterOverlay } from "../overlay.ts";
import { createPinAtlas, type PinIconName } from "../pin-icons.ts";
import type {
  LabelOverlay,
  OverlayDescription,
  PinOverlay,
  PointBatch,
  PolygonBatch,
  RasterOverlay,
  Rgba,
  ShapeData,
  VectorOverlay,
  VectorStyle,
} from "../types.ts";
import {
  type BinaryData,
  pathData,
  pinData,
  pointData,
  polygonFillData,
  polygonOutlineData,
  withCasingColor,
  withoutColors,
} from "./binary-data.ts";

export const pinSizePx = 28;

export const labelFontSizePx = 12;

export const labelPadding = [6, 3] as const;

export interface OverlayLayerBuilder {
  readonly build: (
    overlays: readonly OverlayLayer[],
    pixelsPerUnit?: number,
    view?: ViewRect,
  ) => Layer[];
  readonly lodKey: (
    overlays: readonly OverlayLayer[],
    pixelsPerUnit: number,
    view?: ViewRect,
  ) => string;
  readonly invalidate: (id: string) => void;
}

interface VectorParts {
  readonly fills: BinaryData | null;
  readonly outlines: BinaryData | null;
  readonly paths: BinaryData | null;
  readonly points: BinaryData | null;
  readonly outlineGeometry: BinaryData | null;
  readonly pathGeometry: BinaryData | null;
  readonly pointGeometry: BinaryData | null;
  readonly casingTints: Map<string, BinaryData>;
  readonly lod: LodParts | null;
}

interface DotParts {
  readonly colored: BinaryData;
  readonly plain: BinaryData;
}

interface CullParts {
  readonly polygons: PolygonBatch;
  readonly centres: PointBatch;
  readonly shapeIds: Uint32Array;
  readonly grid: CullGrid;
  cells: CellRect | null | undefined;
  members: Uint32Array | null;
  triangles: Uint32Array | null;
  dots: DotParts | null;
  shapes: VectorParts | null;
}

interface LodParts {
  readonly stats: LodStats;
  readonly dots: DotParts;
  readonly cull: CullParts;
  readonly density: RasterParts | null;
  readonly densityBounds: readonly [number, number, number, number] | null;
  readonly large: VectorParts | null;
}

interface PinParts {
  readonly open: BinaryData | null;
  readonly resolved: BinaryData | null;
}

interface LabelParts {
  readonly entries: readonly LabelEntry[];
}

interface LabelEntry {
  readonly text: string;
  readonly position: readonly [number, number];
  readonly offset: readonly [number, number];
  readonly color: readonly [number, number, number, number];
}

interface RasterParts {
  readonly image: ImageData;
}

interface CacheEntry {
  readonly source: object;
  readonly generation: number;
  readonly parts: VectorParts | PinParts | RasterParts | LabelParts;
}

const unpickable = { pickable: false } as const;

const dashes = new PathStyleExtension({ dash: true, dashMode: "path" });

let sharedPinAtlas: { image: ImageData; mapping: Record<PinIconName, object> } | null = null;

function pinAtlas() {
  if (sharedPinAtlas === null) {
    const atlas = createPinAtlas();
    sharedPinAtlas = {
      image: new ImageData(atlas.rgba, atlas.width, atlas.height),
      mapping: atlas.mapping,
    };
  }
  return sharedPinAtlas;
}

function construct<Instance>(
  type: new (props: never) => Instance,
  props: Record<string, unknown>,
): Instance {
  return new type(props as never);
}

function clampedImage(raster: Pick<RasterOverlay["raster"], "rgba" | "width" | "height">) {
  const { rgba, width, height } = raster;
  const view =
    rgba instanceof Uint8ClampedArray
      ? rgba
      : new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.byteLength);
  return new ImageData(view, width, height);
}

function once<Value>(make: () => Value): () => Value {
  let made = false;
  let value: Value;
  return () => {
    if (!made) {
      value = make();
      made = true;
    }
    return value;
  };
}

function dotParts(centres: PointBatch): DotParts {
  const colored = pointData(centres);
  return { colored, plain: withoutColors(colored) };
}

function cullWindowCells(
  lod: LodParts,
  choice: LodChoice,
  view: ViewRect | undefined,
): CellRect | null | undefined {
  if (view === undefined || choice.tier === "density") return undefined;
  const { cull } = lod;
  const cells = cullWindow(cull.grid, view, cull.cells);
  if (cull.cells === undefined || !sameCells(cells, cull.cells)) {
    cull.cells = cells;
    cull.members = null;
    cull.dots = null;
    cull.shapes = null;
  }
  return cells;
}

function windowMembersOf(cull: CullParts): Uint32Array {
  cull.members ??= windowMembers(cull.grid, cull.cells ?? null);
  return cull.members;
}

function windowDots(cull: CullParts): DotParts | null {
  const members = windowMembersOf(cull);
  if (members.length === 0) return null;
  cull.dots ??= dotParts(pointSubset(cull.centres, members));
  return cull.dots;
}

function windowShapes(cull: CullParts): VectorParts | null {
  const members = windowMembersOf(cull);
  if (members.length === 0) return null;
  if (cull.shapes === null) {
    cull.triangles ??= triangleStarts(cull.polygons);
    const shapes = members.map((member) => cull.shapeIds[member] ?? 0);
    const polygons = polygonSubset(cull.polygons, cull.triangles, shapes);
    cull.shapes = vectorParts({ polygons }, false);
  }
  return cull.shapes;
}

function lodParts(polygons: ShapeData["polygons"]): LodParts | null {
  if (!polygons || polygons.count === 0) return null;
  const stats = lodStats(polygons);
  if (!stats.engaged) return null;
  const centres = smallShapeCentres(polygons, stats);
  const raster = densityRaster(centres, stats.nucleusSize);
  const large = largeShapes(polygons, stats);
  const dots = once(() => dotParts(centres));
  return {
    stats,
    get dots() {
      return dots();
    },
    cull: {
      polygons,
      centres,
      shapeIds: smallShapeIds(polygons.count, stats),
      grid: buildCullGrid(centres, stats.nucleusSize, stats.nucleusSize * lodLargeFactor),
      cells: undefined,
      members: null,
      triangles: null,
      dots: null,
      shapes: null,
    },
    density: raster && { image: clampedImage(raster) },
    densityBounds: raster && [
      raster.area.x,
      raster.area.y + raster.area.height,
      raster.area.x + raster.area.width,
      raster.area.y,
    ],
    large: large && vectorParts({ polygons: large }, false),
  };
}

function vectorParts(shapes: ShapeData, withLod = true): VectorParts {
  const { polygons, paths, points } = shapes;
  const drawn = polygons && polygons.count > 0 ? polygons : null;
  const fills = once(() => drawn && polygonFillData(drawn));
  const outlines = once(() => drawn && polygonOutlineData(drawn));
  const outlineGeometry = once(() => {
    const colored = outlines();
    return colored && withoutColors(colored);
  });
  const lines = paths && paths.count > 0 ? pathData(paths) : null;
  const dots = points && points.count > 0 ? pointData(points) : null;
  return {
    get fills() {
      return fills();
    },
    get outlines() {
      return outlines();
    },
    get outlineGeometry() {
      return outlineGeometry();
    },
    paths: lines,
    points: dots,
    pathGeometry: lines && withoutColors(lines),
    pointGeometry: dots && withoutColors(dots),
    casingTints: new Map(),
    lod: withLod ? lodParts(polygons) : null,
  };
}

function rasterImage(overlay: RasterOverlay): ImageData {
  return clampedImage(overlay.raster);
}

function cullKey(parts: VectorParts, choice: LodChoice, view: ViewRect | undefined): string {
  if (parts.lod === null) return lodKey(choice);
  const cells = cullWindowCells(parts.lod, choice, view);
  return cells === undefined ? lodKey(choice) : `${lodKey(choice)}:${cellsKey(cells)}`;
}

function lodChoice(parts: VectorParts, pixelsPerUnit: number | undefined): LodChoice {
  if (parts.lod === null || pixelsPerUnit === undefined) return fullDetail;
  return chooseLod(parts.lod.stats, pixelsPerUnit);
}

function withoutPolygons(parts: VectorParts): VectorParts {
  return {
    fills: null,
    outlines: null,
    outlineGeometry: null,
    paths: parts.paths,
    points: parts.points,
    pathGeometry: parts.pathGeometry,
    pointGeometry: parts.pointGeometry,
    casingTints: parts.casingTints,
    lod: null,
  };
}

function culledLayers(
  overlay: VectorOverlay,
  parts: VectorParts,
  lod: LodParts,
  choice: LodChoice,
  suffix: string,
): Layer[] {
  const rest = rankedVectorLayers(overlay, withoutPolygons(parts), suffix, true, "");
  if (choice.tier !== "outlines") {
    const dots = choice.tier === "dots" ? windowDots(lod.cull) : null;
    return [...lodLayers(overlay, lod, choice, suffix, dots), ...rest.map(({ layer }) => layer)];
  }
  const near = windowShapes(lod.cull);
  const ranked = [
    ...(near ? rankedVectorLayers(overlay, near, suffix, true, "near-") : []),
    ...(lod.large ? rankedVectorLayers(overlay, lod.large, suffix, true, "large-") : []),
    ...rest,
  ];
  return ranked
    .map((entry, index) => ({ ...entry, index }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ layer }) => layer);
}

function lodLayers(
  overlay: VectorOverlay,
  lod: LodParts,
  choice: LodChoice,
  suffix: string,
  dots: DotParts | null,
): Layer[] {
  const { visible, opacity, style } = overlay;
  const layers: Layer[] = [];
  if (choice.tier === "density" && lod.density && lod.densityBounds) {
    layers.push(
      construct(BitmapLayer, {
        id: `overlay:${overlay.id}:density${suffix}`,
        image: lod.density.image,
        bounds: lod.densityBounds,
        opacity,
        visible,
        textureParameters: { minFilter: "linear", magFilter: "linear", mipmapFilter: "none" },
        ...unpickable,
      }),
    );
  }
  if (choice.tier === "dots" && dots) {
    layers.push(
      construct(ScatterplotLayer, {
        id: `overlay:${overlay.id}:dots${suffix}`,
        data: style.lineColor === null ? dots.colored : dots.plain,
        opacity,
        visible,
        positionFormat: "XY",
        radiusUnits: "pixels",
        getRadius: choice.dotRadiusPx,
        stroked: false,
        filled: true,
        ...(style.lineColor === null ? {} : { getFillColor: style.lineColor }),
        ...unpickable,
      }),
    );
  }
  if (lod.large) layers.push(...vectorLayers(overlay, lod.large, suffix, fullDetail, "large-"));
  return layers;
}

interface RankedLayer {
  readonly rank: number;
  readonly layer: Layer;
}

const partOrder = ["fills", "outline-casings", "path-casings", "outlines", "paths", "points"];

function vectorLayers(
  overlay: VectorOverlay,
  parts: VectorParts,
  suffix: string,
  choice: LodChoice = fullDetail,
  prefix = "",
): Layer[] {
  const detailed = choice.tier === "outlines";
  const layers = rankedVectorLayers(overlay, parts, suffix, detailed, prefix).map(
    ({ layer }) => layer,
  );
  if (!detailed && parts.lod) {
    const dots = choice.tier === "dots" ? parts.lod.dots : null;
    layers.unshift(...lodLayers(overlay, parts.lod, choice, suffix, dots));
  }
  return layers;
}

function rankedVectorLayers(
  overlay: VectorOverlay,
  parts: VectorParts,
  suffix: string,
  detailed: boolean,
  prefix: string,
): RankedLayer[] {
  const { style, visible, opacity } = overlay;
  const { casing, lineColor, dash } = style;
  const base = { visible, ...unpickable };
  const shapeBase = detailed ? base : { ...base, visible: false };
  const layers: Layer[] = [];
  const id = (part: string) => `overlay:${overlay.id}:${prefix}${part}${suffix}`;
  if (parts.fills && style.fillOpacity > 0) {
    layers.push(
      construct(SolidPolygonLayer, {
        ...shapeBase,
        id: id("fills"),
        data: parts.fills,
        opacity: opacity * style.fillOpacity,
        _normalize: false,
        positionFormat: "XY",
        filled: true,
        extruded: false,
      }),
    );
  }
  const stroke = (
    part: string,
    data: BinaryData,
    pathType: "loop" | "open",
    widthPx: number,
    color: Rgba | null,
    dashArray: VectorStyle["dash"],
  ) =>
    construct(PathLayer, {
      ...(pathType === "loop" ? shapeBase : base),
      id: id(part),
      data,
      opacity,
      _pathType: pathType,
      positionFormat: "XY",
      getWidth: widthPx,
      widthUnits: "pixels",
      widthMinPixels: 1,
      jointRounded: true,
      capRounded: dashArray === null,
      ...(color === null ? {} : { getColor: color }),
      ...(dashArray === null
        ? {}
        : { extensions: [dashes], getDashArray: dashArray, dashUnits: "pixels" }),
    });
  if (casing) {
    const casingWidthPx = style.lineWidthPx + 2 * casing.widthPx;
    const casingLine = (
      part: string,
      colored: BinaryData | null,
      plain: BinaryData | null,
      pathType: "loop" | "open",
    ) => {
      if (plain === null) return;
      if (casing.followsAlpha && colored !== null) {
        const key = `${part}:${casing.color.join(",")}`;
        const tinted = parts.casingTints.get(key) ?? withCasingColor(colored, casing.color);
        parts.casingTints.set(key, tinted);
        layers.push(stroke(part, tinted, pathType, casingWidthPx, null, null));
        return;
      }
      layers.push(stroke(part, plain, pathType, casingWidthPx, casing.color, null));
    };
    casingLine("outline-casings", parts.outlines, parts.outlineGeometry, "loop");
    casingLine("path-casings", parts.paths, parts.pathGeometry, "open");
  }
  const lineData = (colored: BinaryData | null, plain: BinaryData | null) =>
    lineColor === null ? colored : plain;
  const outlines = lineData(parts.outlines, parts.outlineGeometry);
  if (outlines) {
    layers.push(stroke("outlines", outlines, "loop", style.lineWidthPx, lineColor, dash));
  }
  const paths = lineData(parts.paths, parts.pathGeometry);
  if (paths) layers.push(stroke("paths", paths, "open", style.lineWidthPx, lineColor, dash));
  const points = lineColor === null ? parts.points : parts.pointGeometry;
  if (points) {
    layers.push(
      construct(ScatterplotLayer, {
        ...base,
        id: id("points"),
        data: points,
        opacity,
        positionFormat: "XY",
        radiusUnits: "pixels",
        getRadius: style.pointRadiusPx + (casing?.widthPx ?? 0),
        stroked: casing !== null,
        lineWidthUnits: "pixels",
        getLineWidth: casing?.widthPx ?? 0,
        getLineColor: casing?.color ?? nearBlack,
        filled: true,
        ...(lineColor === null ? {} : { getFillColor: lineColor }),
      }),
    );
  }
  const rankOf = (layer: Layer) => partOrder.findIndex((part) => layer.id === id(part));
  return layers.map((layer) => ({ rank: rankOf(layer), layer }));
}

function rasterLayers(overlay: RasterOverlay, parts: RasterParts, suffix: string): Layer[] {
  const { area, smooth } = overlay.raster;
  const filter = smooth ? "linear" : "nearest";
  return [
    construct(BitmapLayer, {
      id: `overlay:${overlay.id}:raster${suffix}`,
      image: parts.image,
      bounds: [area.x, area.y + area.height, area.x + area.width, area.y],
      opacity: overlay.opacity,
      visible: overlay.visible,
      textureParameters: { minFilter: filter, magFilter: filter, mipmapFilter: "none" },
      ...unpickable,
    }),
  ];
}

function pinLayers(overlay: PinOverlay, parts: PinParts, suffix: string): Layer[] {
  const atlas = pinAtlas();
  const layers: Layer[] = [];
  for (const state of ["open", "resolved"] as const) {
    const data = parts[state];
    if (data === null) continue;
    layers.push(
      construct(IconLayer, {
        id: `overlay:${overlay.id}:${state}${suffix}`,
        data,
        iconAtlas: atlas.image,
        iconMapping: atlas.mapping,
        getIcon: state,
        positionFormat: "XY",
        getSize: pinSizePx,
        sizeUnits: "pixels",
        opacity: overlay.opacity,
        visible: overlay.visible,
        ...unpickable,
      }),
    );
  }
  return layers;
}

function labelEntries(overlay: LabelOverlay): LabelEntry[] {
  const { count, positions, offsets, colors, texts } = overlay.labels;
  return Array.from({ length: count }, (_, index) => ({
    text: texts[index] ?? "",
    position: [positions[index * 2] ?? 0, positions[index * 2 + 1] ?? 0],
    offset: [
      (offsets[index * 2] ?? 0) + labelPadding[0],
      (offsets[index * 2 + 1] ?? 0) + labelPadding[1],
    ],
    color: [
      colors[index * 4] ?? 0,
      colors[index * 4 + 1] ?? 0,
      colors[index * 4 + 2] ?? 0,
      colors[index * 4 + 3] ?? 255,
    ],
  }));
}

function labelLayers(overlay: LabelOverlay, parts: LabelParts, suffix: string): Layer[] {
  if (parts.entries.length === 0) return [];
  return [
    construct(TextLayer, {
      id: `overlay:${overlay.id}:text${suffix}`,
      data: parts.entries,
      getText: (entry: LabelEntry) => entry.text,
      getPosition: (entry: LabelEntry) => entry.position,
      getPixelOffset: (entry: LabelEntry) => entry.offset,
      getColor: white,
      getSize: labelFontSizePx,
      sizeUnits: "pixels",
      getTextAnchor: "start",
      getAlignmentBaseline: "top",
      fontFamily: "monospace",
      fontWeight: 600,
      fontSettings: { sdf: false },
      background: true,
      backgroundPadding: labelPadding,
      getBackgroundColor: nearBlack,
      getBorderColor: (entry: LabelEntry) => entry.color,
      getBorderWidth: 2,
      billboard: true,
      opacity: overlay.opacity,
      visible: overlay.visible,
      ...unpickable,
    }),
  ];
}

function sourceOf(overlay: OverlayDescription): object {
  if (isRasterOverlay(overlay)) return overlay.raster;
  if (isPinOverlay(overlay)) return overlay.pins;
  if (isLabelOverlay(overlay)) return overlay.labels;
  return overlay.shapes;
}

function partsOf(overlay: OverlayDescription): CacheEntry["parts"] {
  if (isRasterOverlay(overlay)) return { image: rasterImage(overlay) };
  if (isPinOverlay(overlay)) {
    return { open: pinData(overlay.pins, false), resolved: pinData(overlay.pins, true) };
  }
  if (isLabelOverlay(overlay)) return { entries: labelEntries(overlay) };
  return vectorParts(overlay.shapes);
}

export function createOverlayLayerBuilder(): OverlayLayerBuilder {
  const cache = new Map<string, CacheEntry>();
  const generations = new Map<string, number>();

  const entryFor = (overlay: OverlayDescription): CacheEntry => {
    const generation = generations.get(overlay.id) ?? 0;
    const source = sourceOf(overlay);
    const known = cache.get(overlay.id);
    if (known && known.source === source && known.generation === generation) return known;
    const entry = { source, generation, parts: partsOf(overlay) };
    cache.set(overlay.id, entry);
    return entry;
  };

  const layersFor = (
    overlay: OverlayDescription,
    pixelsPerUnit: number | undefined,
    view: ViewRect | undefined,
  ): Layer[] => {
    const { parts, generation } = entryFor(overlay);
    const suffix = generation === 0 ? "" : `:${generation}`;
    if (isRasterOverlay(overlay)) return rasterLayers(overlay, parts as RasterParts, suffix);
    if (isPinOverlay(overlay)) return pinLayers(overlay, parts as PinParts, suffix);
    if (isLabelOverlay(overlay)) return labelLayers(overlay, parts as LabelParts, suffix);
    const vector = parts as VectorParts;
    const choice = lodChoice(vector, pixelsPerUnit);
    if (vector.lod && view !== undefined) {
      cullWindowCells(vector.lod, choice, view);
      return culledLayers(overlay, vector, vector.lod, choice, suffix);
    }
    return vectorLayers(overlay, vector, suffix, choice);
  };

  const isVector = (overlay: OverlayDescription): overlay is VectorOverlay =>
    !isRasterOverlay(overlay) && !isPinOverlay(overlay) && !isLabelOverlay(overlay);

  return {
    lodKey: (overlays, pixelsPerUnit, view) =>
      overlays
        .filter(isOverlayDescription)
        .filter(isVector)
        .map((overlay) => {
          const parts = entryFor(overlay).parts as VectorParts;
          return cullKey(parts, lodChoice(parts, pixelsPerUnit), view);
        })
        .join("|"),
    build: (overlays, pixelsPerUnit, view) => {
      const described = overlays.filter(isOverlayDescription);
      const layers = described.flatMap((overlay) => layersFor(overlay, pixelsPerUnit, view));
      const alive = new Set(described.map((overlay) => overlay.id));
      for (const id of [...cache.keys()]) if (!alive.has(id)) cache.delete(id);
      for (const id of [...generations.keys()]) if (!alive.has(id)) generations.delete(id);
      return layers;
    },
    invalidate: (id) => {
      generations.set(id, (generations.get(id) ?? 0) + 1);
    },
  };
}
