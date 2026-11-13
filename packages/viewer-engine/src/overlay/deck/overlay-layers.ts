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
  chooseLod,
  densityRaster,
  fullDetail,
  type LodChoice,
  type LodStats,
  largeShapes,
  lodKey,
  lodStats,
  smallShapeCentres,
} from "../lod.ts";
import { nearBlack, white } from "../outline-style.ts";
import { isLabelOverlay, isOverlayDescription, isPinOverlay, isRasterOverlay } from "../overlay.ts";
import { createPinAtlas, type PinIconName } from "../pin-icons.ts";
import type {
  LabelOverlay,
  OverlayDescription,
  PinOverlay,
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
  readonly build: (overlays: readonly OverlayLayer[], pixelsPerUnit?: number) => Layer[];
  readonly lodKey: (overlays: readonly OverlayLayer[], pixelsPerUnit: number) => string;
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

interface LodParts {
  readonly stats: LodStats;
  readonly dots: BinaryData;
  readonly dotGeometry: BinaryData;
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

function lodParts(polygons: ShapeData["polygons"]): LodParts | null {
  if (!polygons || polygons.count === 0) return null;
  const stats = lodStats(polygons);
  if (!stats.engaged) return null;
  const centres = smallShapeCentres(polygons, stats);
  const dots = pointData(centres);
  const raster = densityRaster(centres, stats.nucleusSize);
  const large = largeShapes(polygons, stats);
  return {
    stats,
    dots,
    dotGeometry: withoutColors(dots),
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
  const outlines = polygons && polygons.count > 0 ? polygonOutlineData(polygons) : null;
  const lines = paths && paths.count > 0 ? pathData(paths) : null;
  const dots = points && points.count > 0 ? pointData(points) : null;
  return {
    fills: polygons && polygons.count > 0 ? polygonFillData(polygons) : null,
    outlines,
    paths: lines,
    points: dots,
    outlineGeometry: outlines && withoutColors(outlines),
    pathGeometry: lines && withoutColors(lines),
    pointGeometry: dots && withoutColors(dots),
    casingTints: new Map(),
    lod: withLod ? lodParts(polygons) : null,
  };
}

function rasterImage(overlay: RasterOverlay): ImageData {
  return clampedImage(overlay.raster);
}

function lodChoice(parts: VectorParts, pixelsPerUnit: number | undefined): LodChoice {
  if (parts.lod === null || pixelsPerUnit === undefined) return fullDetail;
  return chooseLod(parts.lod.stats, pixelsPerUnit);
}

function lodLayers(
  overlay: VectorOverlay,
  lod: LodParts,
  choice: LodChoice,
  suffix: string,
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
  if (choice.tier === "dots") {
    layers.push(
      construct(ScatterplotLayer, {
        id: `overlay:${overlay.id}:dots${suffix}`,
        data: style.lineColor === null ? lod.dots : lod.dotGeometry,
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

function vectorLayers(
  overlay: VectorOverlay,
  parts: VectorParts,
  suffix: string,
  choice: LodChoice = fullDetail,
  prefix = "",
): Layer[] {
  const { style, visible, opacity } = overlay;
  const { casing, lineColor, dash } = style;
  const base = { visible, ...unpickable };
  const detailed = choice.tier === "outlines";
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
  if (!detailed && parts.lod) layers.unshift(...lodLayers(overlay, parts.lod, choice, suffix));
  return layers;
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

  const layersFor = (overlay: OverlayDescription, pixelsPerUnit: number | undefined): Layer[] => {
    const { parts, generation } = entryFor(overlay);
    const suffix = generation === 0 ? "" : `:${generation}`;
    if (isRasterOverlay(overlay)) return rasterLayers(overlay, parts as RasterParts, suffix);
    if (isPinOverlay(overlay)) return pinLayers(overlay, parts as PinParts, suffix);
    if (isLabelOverlay(overlay)) return labelLayers(overlay, parts as LabelParts, suffix);
    const vector = parts as VectorParts;
    return vectorLayers(overlay, vector, suffix, lodChoice(vector, pixelsPerUnit));
  };

  const isVector = (overlay: OverlayDescription): overlay is VectorOverlay =>
    !isRasterOverlay(overlay) && !isPinOverlay(overlay) && !isLabelOverlay(overlay);

  return {
    lodKey: (overlays, pixelsPerUnit) =>
      overlays
        .filter(isOverlayDescription)
        .filter(isVector)
        .map((overlay) => lodKey(lodChoice(entryFor(overlay).parts as VectorParts, pixelsPerUnit)))
        .join("|"),
    build: (overlays, pixelsPerUnit) => {
      const described = overlays.filter(isOverlayDescription);
      const layers = described.flatMap((overlay) => layersFor(overlay, pixelsPerUnit));
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
