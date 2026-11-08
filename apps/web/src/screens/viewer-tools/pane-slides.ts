export type PaneSide = "left" | "right";

export type PaneSlideIds = Record<PaneSide, string | undefined>;

export const otherSide = (side: PaneSide): PaneSide => (side === "left" ? "right" : "left");

export function pickSlide(shown: PaneSlideIds, side: PaneSide, id: string): PaneSlideIds {
  const there = otherSide(side);
  if (shown[there] === id) return { ...shown, [side]: id, [there]: shown[side] };
  return { ...shown, [side]: id };
}

export function swapSlides(shown: PaneSlideIds): PaneSlideIds {
  return { left: shown.right, right: shown.left };
}
