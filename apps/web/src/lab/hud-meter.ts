export type FrameSummary = { fps: number; frameMs: number; frameP95Ms: number };

export type FrameMeter = {
  readonly record: (now: number) => void;
  readonly summary: () => FrameSummary;
  readonly reset: () => void;
};

const emptySummary: FrameSummary = { fps: 0, frameMs: 0, frameP95Ms: 0 };

export function createFrameMeter(capacity = 120): FrameMeter {
  const gaps = new Float64Array(capacity);
  const scratch = new Float64Array(capacity);
  let filled = 0;
  let next = 0;
  let last = Number.NaN;
  return {
    record(now) {
      if (!Number.isNaN(last)) {
        gaps[next] = now - last;
        next = (next + 1) % capacity;
        if (filled < capacity) filled += 1;
      }
      last = now;
    },
    summary() {
      if (filled === 0) return emptySummary;
      let total = 0;
      for (let index = 0; index < filled; index += 1) {
        const gap = gaps[index] ?? 0;
        scratch[index] = gap;
        total += gap;
      }
      const sorted = scratch.subarray(0, filled).sort();
      const mean = total / filled;
      const p95 = sorted[Math.min(filled - 1, Math.ceil(filled * 0.95) - 1)] ?? 0;
      return { fps: mean > 0 ? 1000 / mean : 0, frameMs: mean, frameP95Ms: p95 };
    },
    reset() {
      filled = 0;
      next = 0;
      last = Number.NaN;
    },
  };
}

export type HudInput = {
  route: "viv" | "webgpu" | "deck";
  frame: FrameSummary;
  residentTiles: number | null;
  inflight: number;
  decodeP95Ms: number | null;
  atlasUsed: number | null;
  annotationsDrawn: number;
  annotationsTotal: number;
  lodTier: string;
};

const count = (value: number): string => Math.round(value).toLocaleString("en-US");

const millis = (value: number | null): string => (value === null ? "-" : `${value.toFixed(1)} ms`);

export function hudLines(input: HudInput): string[] {
  const culled = Math.max(0, input.annotationsTotal - input.annotationsDrawn);
  const lines = [
    `${input.route} · ${Math.round(input.frame.fps)} fps · frame ${millis(input.frame.frameMs)} · p95 ${millis(input.frame.frameP95Ms)}`,
    `tiles ${input.residentTiles === null ? "-" : count(input.residentTiles)} resident · ${count(input.inflight)} in flight · decode p95 ${millis(input.decodeP95Ms)}`,
    `annotations ${count(input.annotationsDrawn)} drawn · ${count(culled)} culled · lod ${input.lodTier}`,
  ];
  if (input.route === "webgpu" && input.atlasUsed !== null) {
    lines.push(`atlas ${Math.round(input.atlasUsed * 100)}% used`);
  }
  return lines;
}

export const hudRefreshMs = 250;
