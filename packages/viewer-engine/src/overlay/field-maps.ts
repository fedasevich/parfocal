import { colormapStep, colormapSteps } from "./colormaps.ts";
import { createRasterOverlay, defaultOverlayState, type OverlayOptions } from "./overlay.ts";
import type { HeatmapGrid, RasterOverlay } from "./types.ts";

export type FieldMapKind = "density" | "confidence";

export const fieldMapKinds: readonly FieldMapKind[] = ["density", "confidence"];

export const fieldMapStops: Record<FieldMapKind, readonly string[]> = {
  density: ["#7c3aed", "#f97316", "#facc15"],
  confidence: ["#1e1b4b", "#0ea5e9", "#e0f2fe"],
};

export const defaultFieldMapThreshold: Record<FieldMapKind, number> = {
  density: 0.05,
  confidence: 0,
};

export const defaultFieldMapOpacity = 0.75;

export interface FieldMapOptions extends OverlayOptions {
  readonly grid: HeatmapGrid;
  readonly threshold?: number;
  readonly smooth?: boolean;
}

const tables = new Map<FieldMapKind, Uint8Array>();

function channels(hex: string): [number, number, number] {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

function tableOf(kind: FieldMapKind): Uint8Array {
  const known = tables.get(kind);
  if (known !== undefined) return known;
  const stops = fieldMapStops[kind].map(channels);
  const table = new Uint8Array(colormapSteps * 3);
  for (let step = 0; step < colormapSteps; step++) {
    const along = (step / (colormapSteps - 1)) * (stops.length - 1);
    const lower = Math.min(stops.length - 2, Math.floor(along));
    const mix = along - lower;
    const from = stops[lower] ?? [0, 0, 0];
    const to = stops[lower + 1] ?? from;
    for (let channel = 0; channel < 3; channel++) {
      table[step * 3 + channel] = Math.round(
        (from[channel] ?? 0) * (1 - mix) + (to[channel] ?? 0) * mix,
      );
    }
  }
  tables.set(kind, table);
  return table;
}

export function fieldMapColor(
  kind: FieldMapKind,
  value: number,
): readonly [red: number, green: number, blue: number] {
  const table = tableOf(kind);
  const offset = colormapStep(value) * 3;
  return [table[offset] ?? 0, table[offset + 1] ?? 0, table[offset + 2] ?? 0];
}

export function colorizeFieldMap(
  kind: FieldMapKind,
  grid: HeatmapGrid,
  threshold: number,
): Uint8Array<ArrayBuffer> {
  const cells = grid.width * grid.height;
  if (grid.values.length !== cells) {
    throw new RangeError("A map grid needs one value for each cell");
  }
  if (Number.isNaN(threshold)) throw new RangeError("A map threshold must be a number");
  const cut = grid.values instanceof Float32Array ? Math.fround(threshold) : threshold;
  const bytes = grid.values instanceof Uint8Array;
  const rgba = new Uint8Array(cells * 4);
  for (let cell = 0; cell < cells; cell++) {
    const raw = grid.values[cell] ?? Number.NaN;
    const value = bytes ? raw / 255 : raw;
    const [red, green, blue] = fieldMapColor(kind, value);
    rgba.set([red, green, blue, !Number.isNaN(value) && value >= cut ? 255 : 0], cell * 4);
  }
  return rgba;
}

export function createFieldMapOverlay(kind: FieldMapKind, options: FieldMapOptions): RasterOverlay {
  const { grid } = options;
  return createRasterOverlay({
    id: options.id,
    kind: "heatmap",
    visible: options.visible ?? defaultOverlayState.visible,
    opacity: options.opacity ?? defaultFieldMapOpacity,
    raster: {
      width: grid.width,
      height: grid.height,
      area: grid.area,
      rgba: colorizeFieldMap(kind, grid, options.threshold ?? defaultFieldMapThreshold[kind]),
      smooth: options.smooth ?? true,
    },
  });
}
