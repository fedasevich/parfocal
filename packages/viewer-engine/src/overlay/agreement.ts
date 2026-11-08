import { polygonBatchFromRings } from "./batches.ts";
import { nearBlack } from "./outline-style.ts";
import { createVectorOverlay } from "./overlay.ts";
import type { Rgba, VectorKind, VectorOverlay, VectorStyle } from "./types.ts";

export const agreementKinds = ["both", "only-a", "only-b"] as const;

export type AgreementKind = (typeof agreementKinds)[number];

export type ComparisonKind = "ai-vs-reviewed" | "model-vs-model" | "reviewer-vs-reviewer";

export const comparisonKinds: readonly ComparisonKind[] = [
  "ai-vs-reviewed",
  "model-vs-model",
  "reviewer-vs-reviewer",
];

export type AgreementCue = "solid" | "dashed" | "double";

export const agreementCues: Readonly<Record<AgreementKind, AgreementCue>> = {
  both: "solid",
  "only-a": "dashed",
  "only-b": "double",
};

export const agreementColours: Readonly<Record<AgreementKind, Rgba>> = {
  both: [74, 222, 128, 255],
  "only-a": [245, 158, 11, 255],
  "only-b": [56, 189, 248, 255],
};

export const comparisonLabels: Readonly<
  Record<ComparisonKind, Readonly<Record<AgreementKind, string>>>
> = {
  "ai-vs-reviewed": {
    both: "AI and reviewer agree",
    "only-a": "AI only",
    "only-b": "Reviewer only",
  },
  "model-vs-model": {
    both: "Both models",
    "only-a": "Model A only",
    "only-b": "Model B only",
  },
  "reviewer-vs-reviewer": {
    both: "Both reviewers",
    "only-a": "First reviewer only",
    "only-b": "Second reviewer only",
  },
};

export const agreementDash = [6, 4] as const;

export const agreementLineWidthPx = 2;

export const agreementDoubleOuterPx = 6;

export const agreementDoubleInnerPx = 2;

export const agreementFillOpacity = 0.12;

export interface AgreementObject {
  readonly id: string;
  readonly ring: ArrayLike<number>;
  readonly agreement: AgreementKind;
}

export interface AgreementOptions {
  readonly id: string;
  readonly objects: readonly AgreementObject[];
  readonly kind?: VectorKind;
  readonly colours?: Readonly<Record<AgreementKind, Rgba>>;
}

export interface AgreementOverlays {
  readonly overlays: VectorOverlay[];
  readonly counts: Readonly<Record<AgreementKind, number>>;
  readonly cues: Readonly<Record<string, AgreementCue>>;
}

const baseStyle: VectorStyle = {
  fillOpacity: agreementFillOpacity,
  lineWidthPx: agreementLineWidthPx,
  pointRadiusPx: 4,
  casing: { widthPx: 0.5, color: nearBlack },
  lineColor: null,
  dash: null,
};

export function agreementCueOf(kind: AgreementKind): AgreementCue {
  return agreementCues[kind];
}

type Ring = { ring: ArrayLike<number>; color: Rgba };

export function agreementOverlays(options: AgreementOptions): AgreementOverlays {
  const kind = options.kind ?? "nuclei";
  const colours = options.colours ?? agreementColours;
  const counts: Record<AgreementKind, number> = { both: 0, "only-a": 0, "only-b": 0 };
  const cues: Record<string, AgreementCue> = {};
  const groups: Record<AgreementKind, Ring[]> = { both: [], "only-a": [], "only-b": [] };
  for (const object of options.objects) {
    counts[object.agreement]++;
    cues[object.id] = agreementCues[object.agreement];
    groups[object.agreement].push({ ring: object.ring, color: colours[object.agreement] });
  }
  const part = (name: string, rings: Ring[], style: VectorStyle, lift = 0) => {
    const overlay = createVectorOverlay({
      id: `${options.id}:${name}`,
      kind,
      shapes: { polygons: polygonBatchFromRings(rings) },
      style,
    });
    return lift === 0 ? overlay : { ...overlay, order: overlay.order + lift };
  };
  const overlays: VectorOverlay[] = [];
  if (groups.both.length > 0) overlays.push(part("both", groups.both, baseStyle));
  if (groups["only-a"].length > 0) {
    overlays.push(
      part("only-a", groups["only-a"], { ...baseStyle, casing: null, dash: agreementDash }),
    );
  }
  if (groups["only-b"].length > 0) {
    overlays.push(
      part("only-b:outer", groups["only-b"], {
        ...baseStyle,
        lineWidthPx: agreementDoubleOuterPx,
        casing: null,
      }),
      part(
        "only-b:inner",
        groups["only-b"],
        {
          ...baseStyle,
          fillOpacity: 0,
          lineWidthPx: agreementDoubleInnerPx,
          casing: null,
          lineColor: nearBlack,
        },
        1,
      ),
    );
  }
  return { overlays, counts, cues };
}
