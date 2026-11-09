import type { ReviewObject } from "@parfocal/api-client";
import { bandOf } from "@parfocal/ui/lib/confidence-words";
import {
  belowCutoffAlpha,
  belowCutoffDash as dashPattern,
  filledAlpha,
  scoreRampHigh,
  scoreRampLow,
} from "@parfocal/viewer-engine/draw-constants";
import { bandColour } from "../review/ai-wording.ts";
import type { RegionStyle } from "../review/slide-still.tsx";

export type ObjectDrawSettings = {
  draw: string;
  width: string;
  opacity: number;
  colorBy: string;
  cutoff: number;
};

export type DecisionOf = (object: string) => "agree" | "disagree" | "unsure" | undefined;

export const belowCutoffFactor = belowCutoffAlpha;

export const belowCutoffDash = dashPattern.join(" ");

export const filledShare = Math.round(filledAlpha * 100);

const decisionCss = {
  agree: "var(--v-agree)",
  disagree: "var(--v-disagree)",
  unsure: "var(--v-unsure)",
  open: "rgb(190 190 190)",
} as const;

const scoreStops = { low: scoreRampLow, high: scoreRampHigh } as const;

export function scoreCss(score: number): string {
  const at = Math.min(1, Math.max(0, score));
  const mix = (index: 0 | 1 | 2) =>
    Math.round(scoreStops.low[index] + (scoreStops.high[index] - scoreStops.low[index]) * at);
  return `rgb(${mix(0)} ${mix(1)} ${mix(2)})`;
}

export const confidenceTintOf = (score: number): string => bandColour(bandOf(score));

export type ObjectStyleInput = {
  settings: ObjectDrawSettings;
  hiddenClasses: ReadonlySet<string>;
  classColour: (className: string) => string;
  decisionOf: DecisionOf;
};

export function objectStyle(
  object: ReviewObject,
  { settings, hiddenClasses, classColour, decisionOf }: ObjectStyleInput,
): RegionStyle {
  if (hiddenClasses.has(object.class_name)) return { stroke: "none" };
  const colour =
    settings.colorBy === "score"
      ? scoreCss(object.score)
      : settings.colorBy === "decision"
        ? decisionCss[decisionOf(object.object) ?? "open"]
        : classColour(object.class_name);
  const below = object.score < settings.cutoff;
  const opacity = (settings.opacity / 100) * (below ? belowCutoffFactor : 1);
  const width = Number(settings.width);
  const filled = settings.draw === "fill";
  return {
    stroke: colour,
    width,
    opacity,
    ...(filled ? { fill: `color-mix(in srgb, ${colour} ${filledShare}%, transparent)` } : {}),
    ...(below ? { dash: belowCutoffDash } : {}),
  };
}
