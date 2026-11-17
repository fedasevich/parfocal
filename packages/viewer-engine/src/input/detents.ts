import { zoomForMagnification } from "../camera/magnification.ts";
import type { CameraProfile } from "../camera/profile.ts";

export const detentMagnifications = [5, 10, 20, 40] as const;

const reachSlack = 1e-6;

export interface DetentContext {
  readonly zoom: number;
  readonly micronsPerPixel: number;
}

interface DetentHold {
  readonly zoom: number;
  readonly direction: 1 | -1;
  readonly sinceMs: number;
  readonly travelled: number;
}

export interface DetentState {
  readonly hold: DetentHold | null;
}

export const freshDetentState: DetentState = { hold: null };

export interface DetentResult {
  readonly octaves: number;
  readonly state: DetentState;
}

function nearestDetent(context: DetentContext, direction: 1 | -1, reach: number): number | null {
  let nearest: number | null = null;
  for (const magnification of detentMagnifications) {
    const zoom = zoomForMagnification(context.micronsPerPixel, magnification);
    const distance = (zoom - context.zoom) * direction;
    if (distance <= reachSlack || distance > reach + reachSlack) continue;
    if (nearest === null || distance < (nearest - context.zoom) * direction) nearest = zoom;
  }
  return nearest;
}

export function applyDetents(
  state: DetentState,
  context: DetentContext,
  octaves: number,
  nowMs: number,
  profile: CameraProfile,
): DetentResult {
  if (octaves === 0 || !Number.isFinite(octaves)) return { octaves, state };
  const direction = octaves > 0 ? 1 : -1;
  const size = Math.abs(octaves);
  const { hold } = state;
  if (hold) {
    const expired = nowMs - hold.sinceMs > profile.detentHoldMs;
    if (!expired && hold.direction === direction) {
      const travelled = hold.travelled + size;
      if (travelled < profile.detentReleaseOctaves) {
        return { octaves: 0, state: { hold: { ...hold, travelled } } };
      }
      const excess = travelled - profile.detentReleaseOctaves;
      return { octaves: direction * excess, state: freshDetentState };
    }
  }
  const detent = nearestDetent(context, direction, size);
  if (detent === null) return { octaves, state: freshDetentState };
  const stop = detent - context.zoom;
  return {
    octaves: stop,
    state: {
      hold: {
        zoom: detent,
        direction,
        sinceMs: nowMs,
        travelled: Math.max(0, size - Math.abs(stop)),
      },
    },
  };
}
