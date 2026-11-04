export const annotateStepKeys = ["kind", "slides", "experts", "check", "how", "send"] as const;

export type AnnotateStep = (typeof annotateStepKeys)[number];

export const presetKeys = ["hand", "run", "sample", "regions", "mixed"] as const;
