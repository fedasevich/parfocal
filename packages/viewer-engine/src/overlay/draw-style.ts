import { pointBatchFromPoints, polygonBatchFromRings } from "./batches.ts";
import {
  belowCutoffAlpha,
  belowCutoffDash,
  filledAlpha,
  scoreRampHigh,
  scoreRampLow,
} from "./draw-constants.ts";
import { type ConfidenceBand, confidenceBand } from "./outline-modes.ts";
import { type ClassName, classColors, nearBlack, white } from "./outline-style.ts";
import { createVectorOverlay, withOverlayState } from "./overlay.ts";
import type { Rgba, VectorKind, VectorOverlay, VectorStyle } from "./types.ts";

export const drawModes = ["outline", "fill", "dots"] as const;

export type DrawMode = (typeof drawModes)[number];

export const drawWidths = [1, 2, 3] as const;

export type DrawWidth = (typeof drawWidths)[number];

export const colourModes = ["class", "score", "decision"] as const;

export type ColourMode = (typeof colourModes)[number];

export type DecisionName = "agree" | "disagree" | "unsure";

export { belowCutoffAlpha, belowCutoffDash, filledAlpha };

export const minDrawOpacity = 20;

export const maxDrawOpacity = 100;

export const decisionColours: Readonly<Record<DecisionName | "open", Rgba>> = {
  agree: [74, 222, 128, 255],
  disagree: [248, 113, 113, 255],
  unsure: [251, 191, 36, 255],
  open: [190, 190, 190, 255],
};

export const confidenceTints: Readonly<Record<ConfidenceBand, Rgba>> = {
  confident: [74, 222, 128, 255],
  likely: [163, 230, 53, 255],
  unsure: [251, 191, 36, 255],
  doubtful: [248, 113, 113, 255],
};

const scoreLow: Rgba = [...scoreRampLow, 255];

const scoreHigh: Rgba = [...scoreRampHigh, 255];

export interface DrawnObject {
  readonly id: string;
  readonly kind: "cell" | "region";
  readonly ring: ArrayLike<number>;
  readonly className: ClassName;
  readonly score: number;
  readonly decision?: DecisionName | null;
}

export interface DrawSettings {
  readonly draw: DrawMode;
  readonly widthPx: DrawWidth;
  readonly opacity: number;
  readonly colourBy: ColourMode;
  readonly cutoff: number;
  readonly hiddenClasses?: ReadonlySet<ClassName>;
}

export interface CurrentObject {
  readonly id: string;
  readonly tint: Rgba | null;
}

export interface DrawOptions {
  readonly id: string;
  readonly objects: readonly DrawnObject[];
  readonly settings: DrawSettings;
  readonly current?: CurrentObject | null;
  readonly kind?: VectorKind;
}

export interface DrawnOverlays {
  readonly overlays: VectorOverlay[];
  readonly scope: readonly string[];
  readonly belowCutoff: readonly string[];
  readonly hiddenByClass: readonly string[];
}

export const defaultDrawSettings: DrawSettings = {
  draw: "outline",
  widthPx: 2,
  opacity: 100,
  colourBy: "class",
  cutoff: 0.4,
};

export function clampOpacity(opacity: number): number {
  return Math.min(maxDrawOpacity, Math.max(minDrawOpacity, Math.round(opacity)));
}

export function scoreColour(score: number): Rgba {
  const at = Math.min(1, Math.max(0, score));
  const mix = (low: number, high: number) => Math.round(low + (high - low) * at);
  return [
    mix(scoreLow[0], scoreHigh[0]),
    mix(scoreLow[1], scoreHigh[1]),
    mix(scoreLow[2], scoreHigh[2]),
    255,
  ];
}

export function confidenceTint(score: number): Rgba {
  return confidenceTints[confidenceBand(score)];
}

export function objectColour(object: DrawnObject, by: ColourMode): Rgba {
  if (by === "score") return scoreColour(object.score);
  if (by === "decision") return decisionColours[object.decision ?? "open"];
  return classColors[object.className];
}

function withAlpha(color: Rgba, alpha: number): Rgba {
  return [color[0], color[1], color[2], Math.round(color[3] * alpha)];
}

function centreOf(ring: ArrayLike<number>): { x: number; y: number } {
  const count = ring.length / 2;
  let x = 0;
  let y = 0;
  for (let index = 0; index < count; index++) {
    x += ring[index * 2] ?? 0;
    y += ring[index * 2 + 1] ?? 0;
  }
  return { x: x / count, y: y / count };
}

function styleOf(settings: DrawSettings, dashed: boolean): Partial<VectorStyle> {
  return {
    fillOpacity: settings.draw === "fill" ? filledAlpha : 0,
    lineWidthPx: settings.widthPx,
    pointRadiusPx: settings.widthPx + 2,
    casing: dashed ? null : { widthPx: 0.5, color: nearBlack, followsAlpha: true },
    ...(dashed ? { dash: belowCutoffDash } : {}),
  };
}

export function drawObjectOverlays(options: DrawOptions): DrawnOverlays {
  const { settings } = options;
  const kind = options.kind ?? "nuclei";
  const hidden = settings.hiddenClasses ?? new Set<ClassName>();
  const visible = options.objects.filter((object) => !hidden.has(object.className));
  const below = visible.filter((object) => object.score < settings.cutoff);
  const above = visible.filter((object) => object.score >= settings.cutoff);
  const opacity = clampOpacity(settings.opacity) / 100;
  const asDot = (object: DrawnObject) => settings.draw === "dots" && object.kind === "cell";

  const overlayFor = (group: readonly DrawnObject[], part: string, dashed: boolean) => {
    if (group.length === 0) return [];
    const alpha = dashed ? belowCutoffAlpha : 1;
    const colored = (object: DrawnObject) =>
      withAlpha(objectColour(object, settings.colourBy), alpha);
    const polygons = group
      .filter((object) => !asDot(object))
      .map((object) => ({ ring: object.ring, color: colored(object) }));
    const dots = group
      .filter(asDot)
      .map((object) => ({ ...centreOf(object.ring), color: colored(object) }));
    const overlay = createVectorOverlay({
      id: `${options.id}:${part}`,
      kind,
      shapes: {
        ...(polygons.length > 0 ? { polygons: polygonBatchFromRings(polygons) } : {}),
        ...(dots.length > 0 ? { points: pointBatchFromPoints(dots) } : {}),
      },
      style: styleOf(settings, dashed),
    });
    return [withOverlayState(overlay, { opacity })];
  };

  const overlays = [...overlayFor(above, "main", false), ...overlayFor(below, "below", true)];
  const picked = options.current;
  const current = picked ? visible.find((object) => object.id === picked.id) : undefined;
  if (picked && current) {
    const ring = createVectorOverlay({
      id: `${options.id}:current`,
      kind,
      shapes: {
        polygons: polygonBatchFromRings([{ ring: current.ring, color: picked.tint ?? white }]),
      },
      style: { fillOpacity: 0, lineWidthPx: settings.widthPx + 1, casing: null, dash: null },
    });
    overlays.push({ ...ring, order: ring.order + 2 });
  }
  return {
    overlays,
    scope: options.objects.map((object) => object.id),
    belowCutoff: below.map((object) => object.id),
    hiddenByClass: options.objects
      .filter((object) => hidden.has(object.className))
      .map((object) => object.id),
  };
}
