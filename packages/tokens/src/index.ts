export const packageName = "@parfocal/tokens";

export const colorTokens = [
  "page",
  "chrome",
  "chrome-2",
  "chrome-3",
  "canvas",
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
  "warn",
  "bad",
  "future",
  "pin",
  "unsure",
] as const;

export type ColorToken = (typeof colorTokens)[number];

export const themes = ["dark", "light"] as const;

export type Theme = (typeof themes)[number];

export const defaultTheme: Theme = "dark";

export const spaceUnitPx = 4;

export const radiiPx = { sm: 4, md: 7, lg: 10 } as const;
