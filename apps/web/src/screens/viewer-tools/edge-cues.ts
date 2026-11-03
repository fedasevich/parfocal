import type { MapRect } from "@parfocal/ui/lib/minimap-box";
import type { ScreenRect } from "./minimap-placement.ts";
import { levelZero } from "./tool-geometry.ts";

export type CueSide = "left" | "right" | "top" | "bottom";

export type CueTarget = { object: string; label: string; centre: [number, number] };

export type EdgeCue = {
  object: string;
  label: string;
  side: CueSide;
  x: number;
  y: number;
  rect: ScreenRect;
  mm: number;
  direction: "back" | "next";
};

export type CueOptions = {
  pill?: { width: number; height: number };
  margin?: number;
  gap?: number;
};

const micronsPerLevelZero = 0.243;

export const micronsPerOverviewPixel = levelZero.overview * micronsPerLevelZero;

export const mmBetween = (a: [number, number], b: [number, number]) =>
  (Math.hypot(a[0] - b[0], a[1] - b[1]) * micronsPerOverviewPixel) / 1000;

export function neighbourTargets(
  order: string[],
  current: string,
  centreOf: (object: string) => [number, number] | undefined,
): (CueTarget & { direction: "back" | "next" })[] {
  const at = order.indexOf(current);
  if (at < 0) return [];
  const picks: [number, "back" | "next"][] = [
    [at - 1, "back"],
    [at + 1, "next"],
  ];
  return picks.flatMap(([index, direction]) => {
    const object = order[index];
    const centre = object ? centreOf(object) : undefined;
    if (!object || !centre) return [];
    const label = direction === "back" ? object : `Area ${index + 1}`;
    return [{ object, label, centre, direction }];
  });
}

const clamp = (value: number, low: number, high: number) =>
  low > high ? (low + high) / 2 : Math.min(high, Math.max(low, value));

export function edgeCues(
  size: { width: number; height: number },
  viewport: MapRect,
  targets: (CueTarget & { direction: "back" | "next" })[],
  options: CueOptions = {},
): EdgeCue[] {
  const pill = options.pill ?? { width: 240, height: 32 };
  const margin = options.margin ?? 14;
  const gap = options.gap ?? 8;
  const [vx, vy, vw, vh] = viewport;
  const here: [number, number] = [vx + vw / 2, vy + vh / 2];
  const centre = { x: size.width / 2, y: size.height / 2 };
  const halfX = Math.max(0, centre.x - margin - pill.width / 2);
  const halfY = Math.max(0, centre.y - margin - pill.height / 2);
  const cues = targets.flatMap((target) => {
    const sx = ((target.centre[0] - vx) / vw) * size.width;
    const sy = ((target.centre[1] - vy) / vh) * size.height;
    if (sx >= 0 && sx <= size.width && sy >= 0 && sy <= size.height) return [];
    const dx = sx - centre.x;
    const dy = sy - centre.y;
    const tx = dx === 0 ? Number.POSITIVE_INFINITY : halfX / Math.abs(dx);
    const ty = dy === 0 ? Number.POSITIVE_INFINITY : halfY / Math.abs(dy);
    const side: CueSide = tx <= ty ? (dx < 0 ? "left" : "right") : dy < 0 ? "top" : "bottom";
    const t = Math.min(tx, ty);
    return [
      {
        object: target.object,
        label: target.label,
        side,
        x: centre.x + dx * t,
        y: centre.y + dy * t,
        mm: mmBetween(here, target.centre),
        direction: target.direction,
      },
    ];
  });
  for (const side of ["left", "right", "top", "bottom"] as const) {
    const vertical = side === "left" || side === "right";
    const step = (vertical ? pill.height : pill.width) + gap;
    const low = margin + (vertical ? pill.height : pill.width) / 2;
    const high = (vertical ? size.height : size.width) - low;
    const row = cues
      .filter((cue) => cue.side === side)
      .sort((a, b) => (vertical ? a.y - b.y : a.x - b.x));
    let floor = Number.NEGATIVE_INFINITY;
    for (const cue of row) {
      const along = Math.max(clamp(vertical ? cue.y : cue.x, low, high), floor);
      if (vertical) cue.y = along;
      else cue.x = along;
      floor = along + step;
    }
    let ceiling = Number.POSITIVE_INFINITY;
    for (const cue of [...row].reverse()) {
      const along = Math.min(vertical ? cue.y : cue.x, ceiling, high);
      if (vertical) cue.y = along;
      else cue.x = along;
      ceiling = along - step;
    }
  }
  return cues.map((cue) => ({
    ...cue,
    rect: [cue.x - pill.width / 2, cue.y - pill.height / 2, pill.width, pill.height],
  }));
}

export function cueStyle(cue: EdgeCue, margin = 14) {
  if (cue.side === "left") return { left: margin, top: cue.y, transform: "translateY(-50%)" };
  if (cue.side === "right") return { right: margin, top: cue.y, transform: "translateY(-50%)" };
  if (cue.side === "top") return { top: margin, left: cue.x, transform: "translateX(-50%)" };
  return { bottom: margin, left: cue.x, transform: "translateX(-50%)" };
}
