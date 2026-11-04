import type { Camera, Viewport } from "./camera.ts";

export interface MotionPredictorTuning {
  readonly windowMs: number;
  readonly halfLifeMs: number;
  readonly minStraightness: number;
  readonly leadMs: number;
  readonly maxViewports: number;
  readonly minSpeedViewportsPerSecond: number;
  readonly minSamples: number;
}

export const motionPredictorTuning: MotionPredictorTuning = {
  windowMs: 160,
  halfLifeMs: 55,
  minStraightness: 0.7,
  leadMs: 300,
  maxViewports: 1.25,
  minSpeedViewportsPerSecond: 0.4,
  minSamples: 3,
};

export interface MotionVector {
  readonly vx: number;
  readonly vy: number;
  readonly speed: number;
  readonly straightness: number;
}

export interface MotionPrediction {
  readonly vector: MotionVector;
  readonly target: { readonly x: number; readonly y: number };
  readonly zoom: number;
}

export interface MotionPredictor {
  sample(timeMs: number, camera: Camera): void;
  vector(): MotionVector | null;
  predict(viewport: Viewport): MotionPrediction | null;
  reset(): void;
}

interface Sample {
  readonly t: number;
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

export function createMotionPredictor(
  tuning: MotionPredictorTuning = motionPredictorTuning,
): MotionPredictor {
  let samples: Sample[] = [];

  const vector = (): MotionVector | null => {
    if (samples.length < tuning.minSamples) return null;
    const first = samples[0];
    const last = samples[samples.length - 1];
    if (first === undefined || last === undefined) return null;
    let weightSum = 0;
    let vx = 0;
    let vy = 0;
    let path = 0;
    for (let index = 1; index < samples.length; index++) {
      const from = samples[index - 1];
      const to = samples[index];
      if (from === undefined || to === undefined) continue;
      const dt = to.t - from.t;
      if (dt <= 0) continue;
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const weight = 0.5 ** ((last.t - (from.t + to.t) / 2) / tuning.halfLifeMs) * dt;
      weightSum += weight;
      vx += (dx / dt) * weight;
      vy += (dy / dt) * weight;
      path += Math.hypot(dx, dy);
    }
    if (weightSum === 0 || path === 0) return null;
    vx /= weightSum;
    vy /= weightSum;
    const speed = Math.hypot(vx, vy);
    if (speed === 0) return null;
    const straightness = Math.hypot(last.x - first.x, last.y - first.y) / path;
    return { vx, vy, speed, straightness };
  };

  return {
    sample(timeMs, camera) {
      const previous = samples[samples.length - 1];
      if (previous !== undefined && (camera.zoom !== previous.zoom || timeMs < previous.t)) {
        samples = [];
      }
      samples.push({ t: timeMs, x: camera.x, y: camera.y, zoom: camera.zoom });
      const cutoff = timeMs - tuning.windowMs;
      let drop = 0;
      while (drop < samples.length - tuning.minSamples && (samples[drop]?.t ?? timeMs) < cutoff) {
        drop++;
      }
      if (drop > 0) samples = samples.slice(drop);
    },
    vector,
    predict(viewport) {
      const last = samples[samples.length - 1];
      const found = vector();
      if (last === undefined || found === null) return null;
      if (found.straightness < tuning.minStraightness) return null;
      const scale = 2 ** last.zoom;
      const ux = found.vx / found.speed;
      const uy = found.vy / found.speed;
      const along =
        Math.abs(ux) * (viewport.width / scale) + Math.abs(uy) * (viewport.height / scale);
      if (found.speed * 1000 < tuning.minSpeedViewportsPerSecond * along) return null;
      const reach = Math.min(found.speed * tuning.leadMs, tuning.maxViewports * along);
      return {
        vector: found,
        target: { x: last.x + ux * reach, y: last.y + uy * reach },
        zoom: last.zoom,
      };
    },
    reset() {
      samples = [];
    },
  };
}
