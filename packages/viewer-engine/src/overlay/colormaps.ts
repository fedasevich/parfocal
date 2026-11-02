import { colormapHex } from "./colormap-data.ts";
import type { HeatmapColormap } from "./types.ts";

export const heatmapColormaps: readonly HeatmapColormap[] = ["viridis", "inferno", "turbo"];

export const colormapSteps = 256;

const tables = new Map<HeatmapColormap, Uint8Array>();

function tableOf(colormap: HeatmapColormap): Uint8Array {
  const known = tables.get(colormap);
  if (known !== undefined) return known;
  const hex = colormapHex[colormap];
  const table = new Uint8Array(colormapSteps * 3);
  for (let index = 0; index < table.length; index++) {
    table[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  tables.set(colormap, table);
  return table;
}

export function isHeatmapColormap(value: unknown): value is HeatmapColormap {
  return heatmapColormaps.includes(value as HeatmapColormap);
}

export function colormapStep(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.round(Math.min(1, Math.max(0, value)) * (colormapSteps - 1));
}

export function colormapColor(
  colormap: HeatmapColormap,
  value: number,
): readonly [red: number, green: number, blue: number] {
  const table = tableOf(colormap);
  const offset = colormapStep(value) * 3;
  return [table[offset] ?? 0, table[offset + 1] ?? 0, table[offset + 2] ?? 0];
}

export function colormapCssGradient(colormap: HeatmapColormap, stops = 9): string {
  const parts: string[] = [];
  for (let stop = 0; stop < stops; stop++) {
    const [red, green, blue] = colormapColor(colormap, stop / (stops - 1));
    parts.push(`rgb(${red} ${green} ${blue}) ${Math.round((stop / (stops - 1)) * 100)}%`);
  }
  return `linear-gradient(90deg, ${parts.join(", ")})`;
}
