export type ViewerPartName =
  | "objects"
  | "layers"
  | "decisions"
  | "opinion"
  | "staging-hero"
  | "area-list"
  | "measure-step"
  | "unsure-zones"
  | "cell-typing";

export type StagingArea = { object: string; size: number };

export type StagingCategory = "macro" | "micro" | "ITC";

export const macroMm = 2;
export const microMm = 0.2;
export const aiSizeError = 0.1;
export const scaleMin = 0.05;
export const scaleMax = 20;

export function stagingCategory(mm: number): StagingCategory {
  if (mm > macroMm) return "macro";
  if (mm > microMm) return "micro";
  return "ITC";
}

export const showsStaging = (parts: readonly ViewerPartName[]) => parts.includes("staging-hero");
