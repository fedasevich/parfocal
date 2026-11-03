import type { Rgba } from "./types.ts";

export interface LabelAnchor {
  readonly id: string;
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly color: Rgba;
}

export interface LabelMetrics {
  readonly charWidthPx: number;
  readonly textHeightPx: number;
  readonly paddingXPx: number;
  readonly paddingYPx: number;
  readonly reachPx: number;
  readonly gapPx: number;
  readonly anchorClearPx: number;
}

export const defaultLabelMetrics: LabelMetrics = {
  charWidthPx: 7.4,
  textHeightPx: 12,
  paddingXPx: 6,
  paddingYPx: 3,
  reachPx: 8,
  gapPx: 3,
  anchorClearPx: 4,
};

export interface PlacedLabel {
  readonly id: string;
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly widthPx: number;
  readonly heightPx: number;
  readonly color: Rgba;
}

export interface LabelPlacement {
  readonly placed: readonly PlacedLabel[];
  readonly hidden: readonly string[];
}

export interface LabelPlacementOptions {
  readonly slidePerScreen: number;
  readonly metrics?: LabelMetrics;
  readonly first?: readonly string[];
  readonly view?: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
}

interface Box {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export function labelBoxSize(text: string, metrics: LabelMetrics = defaultLabelMetrics) {
  return {
    widthPx: text.length * metrics.charWidthPx + 2 * metrics.paddingXPx,
    heightPx: metrics.textHeightPx + 2 * metrics.paddingYPx,
  };
}

export function labelsOverlap(a: Box, b: Box, gapPx = 0): boolean {
  return (
    a.left < b.right + gapPx &&
    b.left < a.right + gapPx &&
    a.top < b.bottom + gapPx &&
    b.top < a.bottom + gapPx
  );
}

function candidateOffsets(
  width: number,
  height: number,
  reach: number,
): readonly (readonly [number, number])[] {
  const rings = [1, 2.5];
  return rings.flatMap((ring) => {
    const r = reach * ring;
    return [
      [r, -height - r],
      [-width - r, -height - r],
      [r, r],
      [-width - r, r],
      [-width / 2, -height - r],
      [-width / 2, r],
      [r, -height / 2],
      [-width - r, -height / 2],
    ] as const;
  });
}

export function placeLabels(
  anchors: readonly LabelAnchor[],
  options: LabelPlacementOptions,
): LabelPlacement {
  const metrics = options.metrics ?? defaultLabelMetrics;
  const { slidePerScreen, view } = options;
  const priority = new Map((options.first ?? []).map((id, index) => [id, index]));
  const inView = anchors.filter(
    (anchor) =>
      view === undefined ||
      (anchor.x >= view.x &&
        anchor.x <= view.x + view.width &&
        anchor.y >= view.y &&
        anchor.y <= view.y + view.height),
  );
  const ordered = inView
    .map((anchor, index) => ({ anchor, index }))
    .sort(
      (a, b) =>
        (priority.get(a.anchor.id) ?? Number.POSITIVE_INFINITY) -
          (priority.get(b.anchor.id) ?? Number.POSITIVE_INFINITY) || a.index - b.index,
    )
    .map((entry) => entry.anchor);
  const screen = (anchor: LabelAnchor) => ({
    x: (anchor.x - (view?.x ?? 0)) / slidePerScreen,
    y: (anchor.y - (view?.y ?? 0)) / slidePerScreen,
  });
  const clear = metrics.anchorClearPx;
  const anchorBoxes = inView.map((anchor) => {
    const at = screen(anchor);
    return { left: at.x - clear, top: at.y - clear, right: at.x + clear, bottom: at.y + clear };
  });
  const frame: Box | null =
    view === undefined
      ? null
      : {
          left: 0,
          top: 0,
          right: view.width / slidePerScreen,
          bottom: view.height / slidePerScreen,
        };
  const taken: Box[] = [];
  const placed: PlacedLabel[] = [];
  const hidden: string[] = [];
  for (const anchor of ordered) {
    const at = screen(anchor);
    const { widthPx, heightPx } = labelBoxSize(anchor.text, metrics);
    const fits = (box: Box) =>
      (frame === null ||
        (box.left >= frame.left &&
          box.top >= frame.top &&
          box.right <= frame.right &&
          box.bottom <= frame.bottom)) &&
      !taken.some((other) => labelsOverlap(box, other, metrics.gapPx)) &&
      !anchorBoxes.some((other) => labelsOverlap(box, other));
    const spot = candidateOffsets(widthPx, heightPx, metrics.reachPx).find(([dx, dy]) =>
      fits({
        left: at.x + dx,
        top: at.y + dy,
        right: at.x + dx + widthPx,
        bottom: at.y + dy + heightPx,
      }),
    );
    if (spot === undefined) {
      hidden.push(anchor.id);
      continue;
    }
    const [offsetX, offsetY] = spot;
    taken.push({
      left: at.x + offsetX,
      top: at.y + offsetY,
      right: at.x + offsetX + widthPx,
      bottom: at.y + offsetY + heightPx,
    });
    placed.push({
      id: anchor.id,
      text: anchor.text,
      x: anchor.x,
      y: anchor.y,
      offsetX,
      offsetY,
      widthPx,
      heightPx,
      color: anchor.color,
    });
  }
  return { placed, hidden };
}

export function placedLabelBox(
  label: PlacedLabel,
  slidePerScreen: number,
  origin: { readonly x: number; readonly y: number } = { x: 0, y: 0 },
): Box {
  const left = (label.x - origin.x) / slidePerScreen + label.offsetX;
  const top = (label.y - origin.y) / slidePerScreen + label.offsetY;
  return { left, top, right: left + label.widthPx, bottom: top + label.heightPx };
}
