import type { Rgba } from "./types.ts";

export const classColors = {
  tumor: [248, 113, 113, 255],
  stroma: [110, 231, 183, 255],
  immune: [192, 132, 252, 255],
  other: [251, 191, 36, 255],
} as const satisfies Readonly<Record<string, Rgba>>;

export type ClassName = keyof typeof classColors;

export const nearBlack: Rgba = [11, 11, 11, 255];

export const white: Rgba = [255, 255, 255, 255];

export const proposalDash = [6, 4] as const;
