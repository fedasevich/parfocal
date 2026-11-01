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

export const spacingPx = {
  zone: 28,
  in: 10,
  padZone: 18,
  padModal: 24,
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
