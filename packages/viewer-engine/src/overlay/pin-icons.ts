export type PinIconName = "open" | "resolved";

export interface PinIconBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly anchorX: number;
  readonly anchorY: number;
}

export interface PinAtlas {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8ClampedArray<ArrayBuffer>;
  readonly mapping: Readonly<Record<PinIconName, PinIconBox>>;
}

export const pinIconSize = 64;

export const pinColors: Readonly<Record<PinIconName, readonly [number, number, number]>> = {
  open: [96, 165, 250],
  resolved: [107, 114, 128],
};

const outline: readonly [number, number, number] = [11, 13, 18];
const headCentre = { x: 32, y: 22 };
const headRadius = 17;
const tip = { x: 32, y: 61 };
const outlineWidth = 2.5;
const dotRadius = 5;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function mix(from: number, to: number, weight: number): number {
  return from + (to - from) * weight;
}

function signedSide(
  from: { readonly x: number; readonly y: number },
  to: { readonly x: number; readonly y: number },
  x: number,
  y: number,
): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return ((x - from.x) * dy - (y - from.y) * dx) / Math.hypot(dx, dy);
}

function pinDistance(x: number, y: number): number {
  const toHead = Math.hypot(x - headCentre.x, y - headCentre.y);
  const head = toHead - headRadius;
  const reach = Math.hypot(tip.x - headCentre.x, tip.y - headCentre.y);
  const spread = Math.acos(headRadius / reach);
  const left = {
    x: headCentre.x + headRadius * Math.sin(spread),
    y: headCentre.y + headRadius * Math.cos(spread),
  };
  const right = {
    x: headCentre.x - headRadius * Math.sin(spread),
    y: headCentre.y + headRadius * Math.cos(spread),
  };
  const edges: readonly (readonly [typeof left, typeof left])[] = [
    [left, right],
    [right, tip],
    [tip, left],
  ];
  const centroid = { x: (left.x + right.x + tip.x) / 3, y: (left.y + right.y + tip.y) / 3 };
  let triangle = Number.NEGATIVE_INFINITY;
  for (const [from, to] of edges) {
    const side = signedSide(from, to, x, y);
    const inward = signedSide(from, to, centroid.x, centroid.y);
    triangle = Math.max(triangle, inward > 0 ? -side : side);
  }
  return Math.min(head, triangle);
}

function drawIcon(
  rgba: Uint8ClampedArray<ArrayBuffer>,
  atlasWidth: number,
  originX: number,
  fill: readonly [number, number, number],
): void {
  for (let row = 0; row < pinIconSize; row++) {
    for (let column = 0; column < pinIconSize; column++) {
      const x = column + 0.5;
      const y = row + 0.5;
      const distance = pinDistance(x, y);
      const alpha = clamp01(0.5 - distance);
      const edge = clamp01(distance + outlineWidth);
      const dot = clamp01(0.5 - (Math.hypot(x - headCentre.x, y - headCentre.y) - dotRadius));
      const weight = Math.max(edge, dot);
      const offset = (row * atlasWidth + originX + column) * 4;
      rgba[offset] = mix(fill[0], outline[0], weight);
      rgba[offset + 1] = mix(fill[1], outline[1], weight);
      rgba[offset + 2] = mix(fill[2], outline[2], weight);
      rgba[offset + 3] = Math.round(alpha * 255);
    }
  }
}

export function createPinAtlas(): PinAtlas {
  const width = pinIconSize * 2;
  const height = pinIconSize;
  const rgba = new Uint8ClampedArray(width * height * 4);
  drawIcon(rgba, width, 0, pinColors.open);
  drawIcon(rgba, width, pinIconSize, pinColors.resolved);
  const box = (x: number): PinIconBox => ({
    x,
    y: 0,
    width: pinIconSize,
    height: pinIconSize,
    anchorX: tip.x,
    anchorY: tip.y + 1,
  });
  return { width, height, rgba, mapping: { open: box(0), resolved: box(pinIconSize) } };
}
