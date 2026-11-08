import type { PaneSide } from "@parfocal/ui/components/viewer-tools";

export type CompareLayout = "one" | "side" | "stacked" | "four";

export const paneSides: readonly PaneSide[] = ["left", "right", "bottomLeft", "bottomRight"];

export const layoutOptions: readonly { value: CompareLayout; label: string }[] = [
  { value: "one", label: "1" },
  { value: "side", label: "Side by side" },
  { value: "stacked", label: "Stacked" },
  { value: "four", label: "4" },
];

const shown: Record<CompareLayout, readonly PaneSide[]> = {
  one: ["left"],
  side: ["left", "right"],
  stacked: ["left", "right"],
  four: paneSides,
};

const grids: Record<CompareLayout, string> = {
  one: "grid-cols-1 grid-rows-1",
  side: "grid-cols-2 grid-rows-1",
  stacked: "grid-cols-1 grid-rows-2",
  four: "grid-cols-2 grid-rows-2",
};

export const paneName: Record<PaneSide, string> = {
  left: "left",
  right: "right",
  bottomLeft: "bottom left",
  bottomRight: "bottom right",
};

export const layerSideOf = (side: PaneSide): "left" | "right" =>
  side === "left" ? "left" : "right";

export const panesOf = (layout: CompareLayout): readonly PaneSide[] => shown[layout];

export const gridOf = (layout: CompareLayout): string => grids[layout];

export const isCompareLayout = (value: string): value is CompareLayout =>
  layoutOptions.some((option) => option.value === value);

export type PaneSlides = Record<PaneSide, string | undefined>;

export function assignSlides(
  caseIds: readonly string[],
  chosen: Partial<Record<PaneSide, string | null | undefined>>,
  defaults: { left: string; right: string | undefined },
): PaneSlides {
  const left = chosen.left ?? defaults.left;
  const right = chosen.right ?? defaults.right;
  const used = new Set([left, right]);
  const spare = (index: number): string | undefined =>
    caseIds.find((id) => !used.has(id)) ?? caseIds[index % Math.max(caseIds.length, 1)];
  const bottomLeft = chosen.bottomLeft ?? spare(2);
  if (bottomLeft !== undefined) used.add(bottomLeft);
  const bottomRight = chosen.bottomRight ?? spare(3);
  return { left, right, bottomLeft, bottomRight };
}

export function pickSlide(
  current: PaneSlides,
  visible: readonly PaneSide[],
  side: PaneSide,
  id: string,
): PaneSlides {
  const there = visible.find((other) => other !== side && current[other] === id);
  return there === undefined
    ? { ...current, [side]: id }
    : { ...current, [side]: id, [there]: current[side] };
}
