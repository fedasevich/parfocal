import type { Camera } from "./camera.ts";

export interface Flight {
  readonly from: Camera;
  readonly to: Camera;
  readonly length: number;
  readonly durationMs: number;
  readonly at: (progress: number) => Camera;
}

export const flightCurvature = Math.SQRT2;
export const shortestFlightMs = 400;
export const longestFlightMs = 700;
export const longestFlightLength = 4;

export function flightDurationMs(length: number): number {
  const share = Math.min(1, Math.max(0, length / longestFlightLength));
  return shortestFlightMs + (longestFlightMs - shortestFlightMs) * share;
}

export function easeInOutCubic(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return clamped < 0.5 ? 4 * clamped ** 3 : 1 - (-2 * clamped + 2) ** 3 / 2;
}

const samePlace = 1e-9;

export function planFlight(from: Camera, to: Camera, viewportWidth: number): Flight {
  if (!(viewportWidth > 0)) {
    throw new RangeError("A flight needs a viewport with a positive width");
  }
  const rho = flightCurvature;
  const rho2 = rho * rho;
  const w0 = viewportWidth / 2 ** from.zoom;
  const w1 = viewportWidth / 2 ** to.zoom;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  const zoomAtWidth = (width: number) => Math.log2(viewportWidth / width);

  let length: number;
  let along: (s: number) => { share: number; width: number };

  if (distance / w0 < samePlace) {
    length = Math.abs(Math.log(w1 / w0)) / rho;
    const direction = Math.sign(Math.log(w1 / w0));
    along = (s) => ({
      share: length === 0 ? 1 : s / length,
      width: w0 * Math.exp(direction * rho * s),
    });
  } else {
    const b0 = (w1 * w1 - w0 * w0 + rho2 * rho2 * distance * distance) / (2 * w0 * rho2 * distance);
    const b1 = (w1 * w1 - w0 * w0 - rho2 * rho2 * distance * distance) / (2 * w1 * rho2 * distance);
    const r0 = Math.log(Math.sqrt(b0 * b0 + 1) - b0);
    const r1 = Math.log(Math.sqrt(b1 * b1 + 1) - b1);
    length = (r1 - r0) / rho;
    const coshR0 = Math.cosh(r0);
    const sinhR0 = Math.sinh(r0);
    along = (s) => ({
      share: (w0 / (rho2 * distance)) * (coshR0 * Math.tanh(rho * s + r0) - sinhR0),
      width: (w0 * coshR0) / Math.cosh(rho * s + r0),
    });
  }

  const at = (progress: number): Camera => {
    if (progress <= 0) return from;
    if (progress >= 1) return to;
    const { share, width } = along(progress * length);
    return { x: from.x + share * dx, y: from.y + share * dy, zoom: zoomAtWidth(width) };
  };

  return { from, to, length, durationMs: flightDurationMs(length), at };
}
