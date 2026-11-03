import { type LabelMetrics, placeLabels } from "@parfocal/viewer-engine";

export type TagToPlace = { object: string; text: string };

export type PlacedTag = {
  object: string;
  text: string;
  left: number;
  top: number;
  width: number;
  height: number;
};

const tagMetrics: LabelMetrics = {
  charWidthPx: 6.9,
  textHeightPx: 14,
  paddingXPx: 10,
  paddingYPx: 3,
  reachPx: 6,
  gapPx: 3,
  anchorClearPx: 3,
};

const noColor = [0, 0, 0, 255] as const;

export function placeSlideTags(
  tags: readonly TagToPlace[],
  anchorOf: (object: string) => { left: number; top: number } | null,
  size: { width: number; height: number },
  first: readonly string[] = [],
): PlacedTag[] {
  const anchors = tags.flatMap((tag) => {
    const at = anchorOf(tag.object);
    return at === null
      ? []
      : [{ id: tag.object, text: tag.text, x: at.left, y: at.top, color: noColor }];
  });
  const { placed } = placeLabels(anchors, {
    slidePerScreen: 1,
    metrics: tagMetrics,
    first,
    view: { x: 0, y: 0, width: size.width, height: size.height },
  });
  return placed.map((label) => ({
    object: label.id,
    text: label.text,
    left: label.x + label.offsetX,
    top: label.y + label.offsetY,
    width: label.widthPx,
    height: label.heightPx,
  }));
}
