import { polygonBatchFromRings } from "./batches.ts";
import { type ClassName, classColors, nearBlack, white } from "./outline-style.ts";
import { createVectorOverlay, defaultVectorStyles } from "./overlay.ts";
import type { Rgba, VectorKind, VectorOverlay, VectorStyle } from "./types.ts";

export const outlineModes = ["fade", "mark-unsure", "bands"] as const;

export type OutlineMode = (typeof outlineModes)[number];

export const defaultOutlineMode: OutlineMode = "fade";

export type ConfidenceBand = "confident" | "likely" | "unsure" | "doubtful";

export const confidenceBandFloors: readonly {
  readonly band: ConfidenceBand;
  readonly min: number;
}[] = [
  { band: "confident", min: 0.8 },
  { band: "likely", min: 0.55 },
  { band: "unsure", min: 0.4 },
  { band: "doubtful", min: 0 },
];

export const bandAlphas: Readonly<Record<ConfidenceBand, number>> = {
  confident: 1,
  likely: 0.55,
  unsure: 0.22,
  doubtful: 0.12,
};

export const classCount = 4;

export const uniformProbability = 1 / classCount;

export const fadeFloor = 0.12;

export const unsureTopBelow = 0.4;

export const closeCallMargin = 0.1;

export const unsureFillAlpha = 0.45;

export const unsureDash = [5, 3] as const;

export const unsureStyle: Partial<VectorStyle> = {
  lineColor: white,
  dash: unsureDash,
  lineWidthPx: 1.5,
  casing: { widthPx: 1, color: nearBlack },
};

export interface TypedOutline {
  readonly ring: ArrayLike<number>;
  readonly className: ClassName;
  readonly top: number;
  readonly second: number;
}

export interface OutlineModeOptions {
  readonly id: string;
  readonly mode: OutlineMode;
  readonly outlines: readonly TypedOutline[];
  readonly kind?: VectorKind;
  readonly style?: Partial<VectorStyle>;
}

const clamp = (value: number) => Math.min(1, Math.max(0, value));

export function fadeStrength(top: number): number {
  return clamp((top - uniformProbability) / (1 - uniformProbability));
}

export function fadeAlpha(top: number): number {
  return fadeFloor + (1 - fadeFloor) * fadeStrength(top);
}

export function confidenceBand(top: number): ConfidenceBand {
  for (const floor of confidenceBandFloors) if (top >= floor.min) return floor.band;
  return "doubtful";
}

export function isUnsureCall(top: number, second: number): boolean {
  return top < unsureTopBelow || top - second < closeCallMargin;
}

export function outlineAlpha(mode: OutlineMode, outline: TypedOutline): number {
  if (mode === "fade") return fadeAlpha(outline.top);
  if (mode === "bands") return bandAlphas[confidenceBand(outline.top)];
  return isUnsureCall(outline.top, outline.second) ? unsureFillAlpha : 1;
}

function withAlpha(color: Rgba, alpha: number): Rgba {
  return [color[0], color[1], color[2], Math.round(color[3] * alpha)];
}

export function outlineModeOverlays(options: OutlineModeOptions): VectorOverlay[] {
  const kind = options.kind ?? "nuclei";
  const colored = (outlines: readonly TypedOutline[]) =>
    polygonBatchFromRings(
      outlines.map((outline) => ({
        ring: outline.ring,
        color: withAlpha(classColors[outline.className], outlineAlpha(options.mode, outline)),
      })),
    );
  const unsure =
    options.mode === "mark-unsure"
      ? options.outlines.filter((outline) => isUnsureCall(outline.top, outline.second))
      : [];
  const plain =
    unsure.length === 0
      ? options.outlines
      : options.outlines.filter((outline) => !unsure.includes(outline));
  const casing =
    options.style?.casing === undefined ? defaultVectorStyles[kind].casing : options.style.casing;
  const main = createVectorOverlay({
    id: options.id,
    kind,
    shapes: { polygons: colored(plain) },
    style: { ...options.style, casing: casing && { ...casing, followsAlpha: true } },
  });
  if (unsure.length === 0) return [main];
  const marked = createVectorOverlay({
    id: `${options.id}:unsure`,
    kind,
    shapes: { polygons: colored(unsure) },
    style: { ...options.style, ...unsureStyle },
  });
  return [main, { ...marked, order: marked.order + 1 }];
}
