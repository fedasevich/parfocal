import type { Layer } from "@deck.gl/core";
import {
  BitmapLayer,
  IconLayer,
  PathLayer,
  ScatterplotLayer,
  SolidPolygonLayer,
} from "@deck.gl/layers";
import type { OverlayLayer } from "../../engine/types.ts";
import { isOverlayDescription, isPinOverlay, isRasterOverlay } from "../overlay.ts";
import { createPinAtlas, type PinIconName } from "../pin-icons.ts";
import type {
  OverlayDescription,
  PinOverlay,
  RasterOverlay,
  ShapeData,
  VectorOverlay,
} from "../types.ts";
import {
  type BinaryData,
  pathData,
  pinData,
  pointData,
  polygonFillData,
  polygonOutlineData,
} from "./binary-data.ts";

export const pinSizePx = 28;

export interface OverlayLayerBuilder {
  readonly build: (overlays: readonly OverlayLayer[]) => Layer[];
  readonly invalidate: (id: string) => void;
}

interface VectorParts {
  readonly fills: BinaryData | null;
  readonly outlines: BinaryData | null;
  readonly paths: BinaryData | null;
  readonly points: BinaryData | null;
}

interface PinParts {
  readonly open: BinaryData | null;
  readonly resolved: BinaryData | null;
}

interface RasterParts {
  readonly image: ImageData;
}

interface CacheEntry {
  readonly source: object;
  readonly generation: number;
  readonly parts: VectorParts | PinParts | RasterParts;
}

const unpickable = { pickable: false } as const;

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

function vectorParts(shapes: ShapeData): VectorParts {
  const { polygons, paths, points } = shapes;
  return {
    fills: polygons && polygons.count > 0 ? polygonFillData(polygons) : null,
    outlines: polygons && polygons.count > 0 ? polygonOutlineData(polygons) : null,
    paths: paths && paths.count > 0 ? pathData(paths) : null,
    points: points && points.count > 0 ? pointData(points) : null,
  };
}

function rasterImage(overlay: RasterOverlay): ImageData {
  const { rgba, width, height } = overlay.raster;
  const view =
    rgba instanceof Uint8ClampedArray
      ? rgba
      : new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.byteLength);
  return new ImageData(view, width, height);
}

function vectorLayers(overlay: VectorOverlay, parts: VectorParts, suffix: string): Layer[] {
  const { style, visible, opacity } = overlay;
  const base = { visible, ...unpickable };
  const layers: Layer[] = [];
  const id = (part: string) => `overlay:${overlay.id}:${part}${suffix}`;
  if (parts.fills && style.fillOpacity > 0) {
    layers.push(
      construct(SolidPolygonLayer, {
        ...base,
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
  const lines = (part: string, data: BinaryData, pathType: "loop" | "open") =>
    construct(PathLayer, {
      ...base,
      id: id(part),
      data,
      opacity,
      _pathType: pathType,
      positionFormat: "XY",
      getWidth: style.lineWidthPx,
      widthUnits: "pixels",
      widthMinPixels: 1,
      jointRounded: true,
      capRounded: true,
    });
  if (parts.outlines) layers.push(lines("outlines", parts.outlines, "loop"));
  if (parts.paths) layers.push(lines("paths", parts.paths, "open"));
  if (parts.points) {
    layers.push(
      construct(ScatterplotLayer, {
        ...base,
        id: id("points"),
        data: parts.points,
        opacity,
        positionFormat: "XY",
        radiusUnits: "pixels",
        getRadius: style.pointRadiusPx,
        stroked: false,
        filled: true,
      }),
    );
  }
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

function sourceOf(overlay: OverlayDescription): object {
  if (isRasterOverlay(overlay)) return overlay.raster;
  if (isPinOverlay(overlay)) return overlay.pins;
  return overlay.shapes;
}

function partsOf(overlay: OverlayDescription): CacheEntry["parts"] {
  if (isRasterOverlay(overlay)) return { image: rasterImage(overlay) };
  if (isPinOverlay(overlay)) {
    return { open: pinData(overlay.pins, false), resolved: pinData(overlay.pins, true) };
  }
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

  const layersFor = (overlay: OverlayDescription): Layer[] => {
    const { parts, generation } = entryFor(overlay);
    const suffix = generation === 0 ? "" : `:${generation}`;
    if (isRasterOverlay(overlay)) return rasterLayers(overlay, parts as RasterParts, suffix);
    if (isPinOverlay(overlay)) return pinLayers(overlay, parts as PinParts, suffix);
    return vectorLayers(overlay, parts as VectorParts, suffix);
  };

  return {
    build: (overlays) => {
      const described = overlays.filter(isOverlayDescription);
      const layers = described.flatMap(layersFor);
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
