import type { SlideArea as ApiSlideArea } from "@parfocal/api-client";
import type { SlideArea } from "@parfocal/viewer-engine";

export type SlideAreaEntry = {
  readonly object: string;
  readonly size: number | null;
  readonly bounds: SlideArea;
};

export const noAreas: readonly SlideAreaEntry[] = [];

export function slideAreaEntries(rows: readonly ApiSlideArea[]): readonly SlideAreaEntry[] {
  return rows
    .filter((row) => row.width > 0 && row.height > 0)
    .map((row) => ({
      object: row.object,
      size: row.size_mm ?? null,
      bounds: { x: row.x, y: row.y, width: row.width, height: row.height },
    }));
}

export const areaPixels = (entry: SlideAreaEntry) =>
  Math.max(entry.bounds.width, entry.bounds.height);

export const areasUnsized = (entries: readonly SlideAreaEntry[]) =>
  entries.length > 0 && entries.every((entry) => entry.size === null);

export const rankSize = (entry: SlideAreaEntry) => entry.size ?? areaPixels(entry);
