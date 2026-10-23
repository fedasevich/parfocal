export interface PointerSample {
  readonly x: number;
  readonly y: number;
  readonly time: number;
}

export interface ScreenVelocity {
  readonly x: number;
  readonly y: number;
}

export interface CoastStep {
  readonly dx: number;
  readonly dy: number;
  readonly velocity: ScreenVelocity;
}

export const velocityWindowMs = 70;
export const releaseIdleMs = 60;
export const minimumThrowSpeed = 0.04;
export const coastDecayMs = 130;
export const coastStopSpeed = 0.01;
export const zoomEaseMs = 55;
export const zoomSettleOctaves = 0.001;

export function speed(velocity: ScreenVelocity): number {
  return Math.hypot(velocity.x, velocity.y);
}

export interface ThrowFeel {
  readonly velocityWindowMs: number;
  readonly releaseIdleMs: number;
  readonly minimumThrowSpeed: number;
}

export const smoothThrow: ThrowFeel = { velocityWindowMs, releaseIdleMs, minimumThrowSpeed };

export function keepRecentSamples(
  samples: readonly PointerSample[],
  now: number,
  windowMs = velocityWindowMs,
): readonly PointerSample[] {
  let first = 0;
  while (samples.length - first > 2 && now - (samples[first]?.time ?? now) > windowMs) {
    first += 1;
  }
  return first === 0 ? samples : samples.slice(first);
}

export function releaseVelocity(
  samples: readonly PointerSample[],
  releaseTime: number,
  feel = smoothThrow,
): ScreenVelocity | null {
  const first = samples[0];
  const last = samples.at(-1);
  if (!first || !last || first === last) return null;
  const span = last.time - first.time;
  if (span <= 0 || releaseTime - last.time > feel.releaseIdleMs) return null;
  const velocity = { x: (last.x - first.x) / span, y: (last.y - first.y) / span };
  if (!Number.isFinite(velocity.x) || !Number.isFinite(velocity.y)) return null;
  return speed(velocity) < feel.minimumThrowSpeed ? null : velocity;
}

export function coastStep(
  velocity: ScreenVelocity,
  elapsedMs: number,
  decayMs = coastDecayMs,
): CoastStep {
  if (!(decayMs > 0)) return { dx: 0, dy: 0, velocity: { x: 0, y: 0 } };
  const elapsed = Math.max(0, elapsedMs);
  const remaining = Math.exp(-elapsed / decayMs);
  const travelled = decayMs * (1 - remaining);
  return {
    dx: velocity.x * travelled,
    dy: velocity.y * travelled,
    velocity: { x: velocity.x * remaining, y: velocity.y * remaining },
  };
}

export function coastDistance(velocity: ScreenVelocity, decayMs = coastDecayMs): ScreenVelocity {
  const reach = Math.max(0, decayMs);
  return { x: velocity.x * reach, y: velocity.y * reach };
}

export function easeZoomStep(
  current: number,
  target: number,
  elapsedMs: number,
  easeMs = zoomEaseMs,
): number {
  if (!(easeMs > 0)) return target;
  const elapsed = Math.max(0, elapsedMs);
  const next = target + (current - target) * Math.exp(-elapsed / easeMs);
  return Math.abs(next - target) < zoomSettleOctaves ? target : next;
}
