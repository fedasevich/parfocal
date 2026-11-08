import type { PaneSide } from "@parfocal/ui/components/viewer-tools";

export type PaneSlideIds = Partial<Record<PaneSide, string | undefined>>;

const sideBySide: readonly PaneSide[] = ["left", "right"];

export function pickSlide(
  shown: PaneSlideIds,
  side: PaneSide,
  id: string,
  visible: readonly PaneSide[] = sideBySide,
): PaneSlideIds {
  const there = visible.find((other) => other !== side && shown[other] === id);
  if (there !== undefined) return { ...shown, [side]: id, [there]: shown[side] };
  return { ...shown, [side]: id };
}

export function swapSlides(shown: PaneSlideIds): PaneSlideIds {
  return { ...shown, left: shown.right, right: shown.left };
}
