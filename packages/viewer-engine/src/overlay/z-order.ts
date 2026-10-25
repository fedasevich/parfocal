export const overlayStack = [
  "coverage",
  "heatmap",
  "nuclei",
  "ai-proposals",
  "human-annotations",
  "measurements",
  "comment-pins",
] as const;

export type OverlayKind = (typeof overlayStack)[number];

export const overlayOrderStep = 100;

export function overlayOrder(kind: OverlayKind): number {
  return (overlayStack.indexOf(kind) + 1) * overlayOrderStep;
}

export function isOverlayKind(value: unknown): value is OverlayKind {
  return overlayStack.includes(value as OverlayKind);
}
