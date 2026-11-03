export const packageName = "@parfocal/tokens";

export const colorTokens = [
  "surf-page",
  "surf-panel",
  "surf-section",
  "surf-field",
  "surf-hl",
  "surf-edge",
  "page",
  "chrome",
  "chrome-2",
  "chrome-3",
  "canvas",
  "tl-a",
  "tl-b",
  "line",
  "line-strong",
  "fg",
  "fg-dim",
  "fg-faint",
  "accent",
  "accent-fill",
  "accent-soft",
  "on-accent",
  "ok",
  "on-ok",
  "ok-fill",
  "warn",
  "warn-soft",
  "bad",
  "bad-fill",
  "unsure",
  "future",
  "pin",
  "research-fg",
  "res",
  "track",
  "seg-track",
  "seg-on",
  "btn-bg",
  "v-agree",
  "v-disagree",
  "v-unsure",
  "v-open",
  "st-1",
  "st-2",
  "st-3",
  "scrim",
] as const;

export type ColorToken = (typeof colorTokens)[number];

export const themedTokens = [...colorTokens, "shadow"] as const;

export type ThemedToken = (typeof themedTokens)[number];

export const classColors = {
  tumor: "#f87171",
  stroma: "#6ee7b7",
  immune: "#c084fc",
  other: "#fbbf24",
} as const;

export type ClassName = keyof typeof classColors;

export const proposalColor = { stroke: "#0b0b0b", casing: "#ffffff" } as const;

export const unsureColor = { dark: "#cbd5e1", light: "#475569" } as const;

export const decisionTokens = ["v-agree", "v-disagree", "v-unsure", "v-open"] as const;

export type Decision = "agree" | "disagree" | "unsure" | "open";

export const themes = ["dark", "light"] as const;

export type Theme = (typeof themes)[number];

export const defaultTheme: Theme = "dark";

export const spaceUnitPx = 4;

export const radiiPx = { sm: 4, md: 7, lg: 10, ctl: 8, zone: 12 } as const;

export const surfaceLevels = ["page", "panel", "section", "highlight"] as const;

export type SurfaceLevel = (typeof surfaceLevels)[number];

export const surfaceLevelTokens = {
  page: "surf-page",
  panel: "surf-panel",
  section: "surf-section",
  highlight: "surf-hl",
} as const satisfies Record<SurfaceLevel, string>;

export const surfaceSpacingPx = {
  "space-zone": { comfortable: 28, compact: 24 },
  "space-in": { comfortable: 10, compact: 8 },
  "pad-zone": { comfortable: 18, compact: 14 },
  "pad-modal": { comfortable: 24, compact: 24 },
} as const satisfies Record<string, Record<DensityMode, number>>;

export type SurfaceSpacing = keyof typeof surfaceSpacingPx;

export const surfaceSpacingRulesPx = {
  "space-zone": { min: 24, max: 32 },
  "space-in": { min: 8, max: 12 },
  "pad-modal": { min: 24, max: Number.POSITIVE_INFINITY },
} as const satisfies Partial<Record<SurfaceSpacing, { min: number; max: number }>>;

export const spacingPx = {
  zone: surfaceSpacingPx["space-zone"].comfortable,
  in: surfaceSpacingPx["space-in"].comfortable,
  padZone: surfaceSpacingPx["pad-zone"].comfortable,
  padModal: surfaceSpacingPx["pad-modal"].comfortable,
  padSmallModal: 20,
} as const;

export const controlHeightsPx = { sm: 28, md: 32, lg: 40 } as const;

export const tagHeightPx = 20;

export const countHeightPx = 16;

export const iconSizesPx = { xs: 12, sm: 16, md: 20, lg: 24, xl: 40 } as const;

export type IconSize = keyof typeof iconSizesPx;

export const typeScale = {
  label: { size: 11, weight: 600, line: 16 },
  caption: { size: 12, weight: 400, line: 16 },
  "body-sm": { size: 13, weight: 400, line: 18 },
  body: { size: 14, weight: 400, line: 20 },
  lead: { size: 16, weight: 400, line: 24 },
  "title-sm": { size: 18, weight: 600, line: 24 },
  title: { size: 20, weight: 600, line: 28 },
  "page-title": { size: 24, weight: 600, line: 32 },
  display: { size: 28, weight: 600, line: 36 },
} as const;

export type TypeStyle = keyof typeof typeScale;

export const smallModalWidthsPx = [480, 560] as const;

export const flowPageMainMaxPx = 760;

export const motionDurationsMs = { fast: 120, base: 200, slow: 300, slower: 400 } as const;

export type MotionDuration = keyof typeof motionDurationsMs;

export const motionEasings = {
  standard: [0.2, 0, 0, 1],
  enter: [0, 0, 0.2, 1],
  exit: [0.4, 0, 1, 1],
  "in-out": [0.65, 0, 0.35, 1],
} as const;

export type MotionEasing = keyof typeof motionEasings;

export const motionModes = ["normal", "presenting", "reduced"] as const;

export type MotionMode = (typeof motionModes)[number];

export const motionScale: Record<MotionMode, number> = { normal: 1, presenting: 3, reduced: 0 };

export const reducedMotionQuery = "(prefers-reduced-motion: reduce)";

export function effectiveMotionMode(mode: MotionMode, prefersReduced: boolean): MotionMode {
  return prefersReduced ? "reduced" : mode;
}

export function motionMs(duration: MotionDuration, mode: MotionMode = "normal"): number {
  return motionDurationsMs[duration] * motionScale[mode];
}

export function cubicBezierCss(easing: MotionEasing): string {
  return `cubic-bezier(${motionEasings[easing].join(", ")})`;
}

export const densityModes = ["comfortable", "compact"] as const;

export type DensityMode = (typeof densityModes)[number];

export const densitySpacingPx = {
  "list-row-y": { comfortable: 12, compact: 7 },
  "cell-y": { comfortable: 8, compact: 4 },
  "head-h": { comfortable: 32, compact: 28 },
  "head-y": { comfortable: 7, compact: 4 },
  "panel-gap": { comfortable: 22, compact: 14 },
  "panel-pad": { comfortable: 20, compact: 14 },
  "foot-x": { comfortable: 20, compact: 14 },
  "foot-top": { comfortable: 14, compact: 10 },
  "foot-bottom": { comfortable: 18, compact: 12 },
  "item-y": { comfortable: 10, compact: 6 },
  "page-gap": { comfortable: 22, compact: 14 },
  "flow-gap": { comfortable: 16, compact: 14 },
} as const satisfies Record<string, Record<DensityMode, number>>;

export type DensitySpacing = keyof typeof densitySpacingPx;

export function densityMode(value: unknown): DensityMode {
  return value === "compact" ? "compact" : "comfortable";
}
