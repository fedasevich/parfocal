import { colormapColor, isHeatmapColormap } from "./colormaps.ts";
import {
  createRasterOverlay,
  defaultOverlayState,
  type OverlayOptions,
  withOverlayState,
} from "./overlay.ts";
import type {
  HeatmapColormap,
  HeatmapData,
  HeatmapGrid,
  HeatmapLook,
  HeatmapSource,
  OverlayDescription,
  RasterData,
  RasterOverlay,
} from "./types.ts";

export const defaultHeatmapLook: HeatmapLook = { colormap: "viridis", threshold: 0.08 };

export const defaultHeatmapOpacity = 0.7;

export type HeatmapOverlay = RasterOverlay & { readonly heatmap: HeatmapData };

export interface HeatmapOverlayOptions extends OverlayOptions {
  readonly grid: HeatmapGrid;
  readonly source: HeatmapSource;
  readonly colormap?: HeatmapColormap;
  readonly threshold?: number;
  readonly smooth?: boolean;
}

function checkedLook(look: Partial<HeatmapLook>, base: HeatmapLook): HeatmapLook {
  const colormap = look.colormap ?? base.colormap;
  const threshold = look.threshold ?? base.threshold;
  if (!isHeatmapColormap(colormap))
    throw new RangeError(`Unknown heatmap colormap ${String(colormap)}`);
  if (Number.isNaN(threshold)) throw new RangeError("A heatmap threshold must be a number");
  return { colormap, threshold: Math.min(1, Math.max(0, threshold)) };
}

function probability(grid: HeatmapGrid, index: number): number {
  const raw = grid.values[index] ?? Number.NaN;
  return grid.values instanceof Uint8Array ? raw / 255 : raw;
}

export function colorizeHeatmap(grid: HeatmapGrid, look: HeatmapLook): Uint8Array<ArrayBuffer> {
  const cells = grid.width * grid.height;
  if (grid.values.length !== cells) {
    throw new RangeError("A heatmap grid needs one value for each cell");
  }
  const rgba = new Uint8Array(cells * 4);
  const cut = grid.values instanceof Float32Array ? Math.fround(look.threshold) : look.threshold;
  for (let cell = 0; cell < cells; cell++) {
    const value = probability(grid, cell);
    const [red, green, blue] = colormapColor(look.colormap, value);
    const shown = !Number.isNaN(value) && value >= cut;
    rgba.set([red, green, blue, shown ? 255 : 0], cell * 4);
  }
  return rgba;
}

function rasterOf(grid: HeatmapGrid, look: HeatmapLook, smooth: boolean | undefined): RasterData {
  const { width, height, area } = grid;
  return {
    width,
    height,
    area,
    rgba: colorizeHeatmap(grid, look),
    smooth: smooth ?? true,
  };
}

export function createHeatmapOverlay(options: HeatmapOverlayOptions): HeatmapOverlay {
  const look = checkedLook(options, defaultHeatmapLook);
  const { grid, source, smooth } = options;
  const base = createRasterOverlay({
    id: options.id,
    kind: "heatmap",
    visible: options.visible ?? defaultOverlayState.visible,
    opacity: options.opacity ?? defaultHeatmapOpacity,
    raster: rasterOf(grid, look, smooth),
  });
  return { ...base, heatmap: { grid, look, source } };
}

export function isHeatmapOverlay(overlay: OverlayDescription): overlay is HeatmapOverlay {
  return overlay.kind === "heatmap" && "heatmap" in overlay && overlay.heatmap !== undefined;
}

export function withHeatmapLook(
  overlay: HeatmapOverlay,
  change: Partial<HeatmapLook>,
): HeatmapOverlay {
  const look = checkedLook(change, overlay.heatmap.look);
  return {
    ...withOverlayState(overlay, {}),
    raster: rasterOf(overlay.heatmap.grid, look, overlay.raster.smooth),
    heatmap: { ...overlay.heatmap, look },
  };
}

export function heatmapSourceLabel(source: HeatmapSource): string {
  return source.version === null ? source.model : `${source.model} ${source.version}`;
}

export const heatmapStrengthSteps: readonly number[] = [0, 20, 30, 40, 50, 60, 70, 80, 90, 100];

export function snapHeatmapStrength(strength: number): number {
  if (Number.isNaN(strength) || strength < 15) return 0;
  return Math.min(100, Math.max(20, Math.round(strength / 10) * 10));
}

export function heatmapStrengthState(strength: number): { visible: boolean; opacity: number } {
  const snapped = snapHeatmapStrength(strength);
  return { visible: snapped > 0, opacity: snapped / 100 };
}
