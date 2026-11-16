import type { ViewMapScorer, ViewMapTileRequest } from "@parfocal/viewer-engine";
import { readBuildConfig } from "../config.ts";

export const fakeTumorSpots = [
  { x: 0.32, y: 0.4, radius: 0.08, peak: 0.99 },
  { x: 0.64, y: 0.58, radius: 0.05, peak: 0.9 },
  { x: 0.5, y: 0.22, radius: 0.03, peak: 0.6 },
] as const;

export function fakeTumorProbability(
  slide: { readonly width: number; readonly height: number },
  x: number,
  y: number,
): number {
  const side = Math.max(slide.width, slide.height);
  let highest = 0;
  for (const spot of fakeTumorSpots) {
    const dx = (x - spot.x * slide.width) / (spot.radius * side);
    const dy = (y - spot.y * slide.height) / (spot.radius * side);
    highest = Math.max(highest, spot.peak * Math.exp(-(dx * dx + dy * dy)));
  }
  return highest;
}

export function createFakeViewMapScorer(slide: {
  readonly width: number;
  readonly height: number;
}): ViewMapScorer & { readonly asked: ViewMapTileRequest[] } {
  const asked: ViewMapTileRequest[] = [];
  const scorer = (request: ViewMapTileRequest) => {
    asked.push(request);
    const values = new Uint8Array(request.width * request.height);
    for (let row = 0; row < request.height; row++) {
      for (let column = 0; column < request.width; column++) {
        const x = request.area.x + (column + 0.5) * request.cell;
        const y = request.area.y + (row + 0.5) * request.cell;
        values[row * request.width + column] = Math.round(255 * fakeTumorProbability(slide, x, y));
      }
    }
    return Promise.resolve(values);
  };
  return Object.assign(scorer, { asked });
}

export function viewMapScorerFor(slide: {
  readonly width: number;
  readonly height: number;
}): ViewMapScorer | null {
  if (import.meta.env.PARFOCAL_PUBLIC_DEV_TOOLS === "on" && readBuildConfig().fakeApi !== "off")
    return createFakeViewMapScorer(slide);
  return null;
}
