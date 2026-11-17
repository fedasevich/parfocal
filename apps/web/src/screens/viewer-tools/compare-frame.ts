import type { StillFrame } from "../../viewer/still-frame.ts";
import { overviewSize } from "../review/slide-geometry.ts";

type Point = { readonly x: number; readonly y: number };

const wholeOverview: StillFrame = { scale: 1, offsetX: 0, offsetY: 0 };

export const overviewCentre: Point = { x: overviewSize.width / 2, y: overviewSize.height / 2 };

export function slideExtentOf(frame: StillFrame = wholeOverview) {
  const width = overviewSize.width + (2 * frame.offsetX) / frame.scale;
  const height = overviewSize.height + (2 * frame.offsetY) / frame.scale;
  return {
    size: { width, height },
    left: overviewCentre.x - width / 2,
    top: overviewCentre.y - height / 2,
  };
}

export function shareOfOverview(point: Point, frame?: StillFrame): Point {
  const extent = slideExtentOf(frame);
  return {
    x: (point.x - extent.left) / extent.size.width,
    y: (point.y - extent.top) / extent.size.height,
  };
}

export function overviewOfShare(share: Point, frame?: StillFrame): Point {
  const extent = slideExtentOf(frame);
  return {
    x: extent.left + share.x * extent.size.width,
    y: extent.top + share.y * extent.size.height,
  };
}

export function turnedHost(rotation: number, size: { width: number; height: number }) {
  if (rotation === 0) return { left: 0, top: 0, width: size.width, height: size.height };
  const side = Math.ceil(Math.hypot(size.width, size.height));
  return {
    left: (size.width - side) / 2,
    top: (size.height - side) / 2,
    width: side,
    height: side,
    transform: `rotate(${rotation}deg)`,
  };
}
