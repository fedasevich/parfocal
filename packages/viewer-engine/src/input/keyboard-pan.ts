import type { CameraProfile } from "../camera/profile.ts";
import type { Clock, FrameScheduler } from "../engine/types.ts";

export type PanDirection = "up" | "down" | "left" | "right";

export const keyPanStepsPerSecond = 8;
export const fastKeyPanFactor = 3;
export const keyZoomFactor = 1.35;
export const keyZoomOctaves = Math.log2(keyZoomFactor);

const longestFrameMs = 100;
const restingPxPerMs = 0.001;

const directionVector: Record<PanDirection, readonly [number, number]> = {
  up: [0, 1],
  down: [0, -1],
  left: [1, 0],
  right: [-1, 0],
};

export interface KeyPanState {
  readonly held: readonly PanDirection[];
  readonly fast: boolean;
  readonly vx: number;
  readonly vy: number;
}

export const restingKeyPan: KeyPanState = { held: [], fast: false, vx: 0, vy: 0 };

export function keyPanCruisePxPerMs(profile: CameraProfile, fast: boolean): number {
  const perSecond = profile.keyPanStepPx * keyPanStepsPerSecond * (fast ? fastKeyPanFactor : 1);
  return Math.max(0, perSecond) / 1000;
}

export function keyPanTarget(state: KeyPanState, profile: CameraProfile): { x: number; y: number } {
  let x = 0;
  let y = 0;
  for (const direction of new Set(state.held)) {
    const [dx, dy] = directionVector[direction];
    x += dx;
    y += dy;
  }
  const length = Math.hypot(x, y);
  if (length === 0) return { x: 0, y: 0 };
  const speed = keyPanCruisePxPerMs(profile, state.fast);
  return { x: (x / length) * speed, y: (y / length) * speed };
}

export function keyPanMoving(state: KeyPanState): boolean {
  return state.held.length > 0 || Math.hypot(state.vx, state.vy) > restingPxPerMs;
}

function ease(start: number, target: number, ms: number, rampMs: number) {
  if (rampMs <= 0) return { speed: target, travel: target * ms };
  const decay = Math.exp(-ms / rampMs);
  return {
    speed: target + (start - target) * decay,
    travel: target * ms + (start - target) * rampMs * (1 - decay),
  };
}

export function advanceKeyPan(
  state: KeyPanState,
  profile: CameraProfile,
  elapsedMs: number,
): { state: KeyPanState; dx: number; dy: number } {
  const ms = Math.min(longestFrameMs, Math.max(0, Number.isFinite(elapsedMs) ? elapsedMs : 0));
  const target = keyPanTarget(state, profile);
  const ramp = Math.max(0, profile.keyPanRampMs);
  const x = ease(state.vx, target.x, ms, ramp);
  const y = ease(state.vy, target.y, ms, ramp);
  const next = { ...state, vx: x.speed, vy: y.speed };
  const settled = keyPanMoving(next) ? next : { ...next, vx: 0, vy: 0 };
  return { state: settled, dx: x.travel, dy: y.travel };
}

export interface KeyPanHost {
  readonly panBy: (dx: number, dy: number) => void;
  readonly profile: () => CameraProfile;
  readonly now: Clock;
  readonly frames: FrameScheduler;
}

export interface KeyPan {
  readonly press: (direction: PanDirection, fast?: boolean) => void;
  readonly release: (direction: PanDirection) => void;
  readonly setFast: (fast: boolean) => void;
  readonly stop: () => void;
  readonly moving: () => boolean;
}

export function createKeyPan(host: KeyPanHost): KeyPan {
  let state = restingKeyPan;
  let frame: number | null = null;
  let last = 0;

  const tick = () => {
    frame = null;
    const now = host.now();
    const result = advanceKeyPan(state, host.profile(), now - last);
    last = now;
    state = result.state;
    if (result.dx !== 0 || result.dy !== 0) host.panBy(result.dx, result.dy);
    if (keyPanMoving(state)) frame = host.frames.request(tick);
  };

  const wake = () => {
    if (frame !== null || !keyPanMoving(state)) return;
    last = host.now();
    frame = host.frames.request(tick);
  };

  return {
    press: (direction, fast) => {
      const held = state.held.includes(direction) ? state.held : [...state.held, direction];
      state = { ...state, held, fast: fast ?? state.fast };
      wake();
    },
    release: (direction) => {
      state = { ...state, held: state.held.filter((held) => held !== direction) };
    },
    setFast: (fast) => {
      state = { ...state, fast };
    },
    stop: () => {
      if (frame !== null) host.frames.cancel(frame);
      frame = null;
      state = restingKeyPan;
    },
    moving: () => keyPanMoving(state),
  };
}
