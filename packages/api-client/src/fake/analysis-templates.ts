import type { AnalysisTemplate, ViewerPart } from "../generated/api.ts";

const baseParts: ViewerPart[] = ["objects", "layers", "decisions", "opinion"];

const templateParts: Record<AnalysisTemplate, ViewerPart[]> = {
  none: [],
  "sentinel-node": ["staging-hero", "area-list", "measure-step"],
  "cell-review": ["unsure-zones", "cell-typing"],
};

export const viewerPartsOf = (template: AnalysisTemplate): ViewerPart[] => [
  ...baseParts,
  ...templateParts[template],
];
