import type { Fired } from "../../keys/registry.ts";
import { cameraToSearch } from "../review/camera-search.ts";
import type { Spot } from "../viewer/area-nav.ts";

export type PeekEffect = "hold" | "latch" | "close" | null;

export type PeekKeyStep = { closing: boolean; effect: PeekEffect };

export function peekKeyStep(open: boolean, closing: boolean, fired: Fired): PeekKeyStep {
  if (fired.action === "esc") return { closing, effect: open ? "close" : null };
  if (fired.phase === "hold-start") return { closing: open, effect: open ? "close" : "hold" };
  if (closing) return { closing: false, effect: null };
  if (fired.phase === "tap") return { closing: false, effect: "latch" };
  if (fired.phase === "hold-end") return { closing: false, effect: "close" };
  return { closing, effect: null };
}

export const peekGoScale = 1.5;

export function peekSpot(point: readonly [number, number]): Spot {
  return {
    object: null,
    ...cameraToSearch("overview", { x: point[0], y: point[1], scale: peekGoScale }),
  };
}
