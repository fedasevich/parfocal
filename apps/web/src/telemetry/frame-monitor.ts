export const longFrameMs = 50;
export const reportEveryMs = 60_000;
export const activeAfterInputMs = 1_000;
const maxSamples = 10_000;

export type Renderer = "viv" | "deck-webgpu" | "custom-webgpu";

export type FrameSummary = {
  renderer: Renderer;
  frames: number;
  p50_ms: number;
  p95_ms: number;
  long_frames: number;
};

export type FrameReporter = { report(summary: FrameSummary): void };

export const framesPath = "/api/telemetry/frames";

export const consoleFrames: FrameReporter = {
  report(summary) {
    console.debug("viewer frames", summary);
  },
};

let delegate: FrameReporter = consoleFrames;

export const appFrameReporter: FrameReporter = { report: (summary) => delegate.report(summary) };

export function connectFrameReporter(reporter: FrameReporter): void {
  delegate = reporter;
}

export function beaconFrames(send: (path: string, body: Blob) => boolean): FrameReporter {
  return {
    report(summary) {
      send(framesPath, new Blob([JSON.stringify(summary)], { type: "application/json" }));
    },
  };
}

function percentile(sorted: readonly number[], share: number): number {
  const index = Math.min(sorted.length - 1, Math.ceil(share * sorted.length) - 1);
  return Math.round((sorted[Math.max(0, index)] ?? 0) * 10) / 10;
}

export function summarise(renderer: Renderer, frameMs: readonly number[]): FrameSummary | null {
  if (frameMs.length === 0) return null;
  const sorted = [...frameMs].sort((a, b) => a - b);
  return {
    renderer,
    frames: sorted.length,
    p50_ms: percentile(sorted, 0.5),
    p95_ms: percentile(sorted, 0.95),
    long_frames: sorted.filter((ms) => ms > longFrameMs).length,
  };
}

export type FrameMonitor = {
  input(at: number): void;
  frame(at: number): boolean;
  flush(): void;
};

export function createFrameMonitor(renderer: Renderer, reporter: FrameReporter): FrameMonitor {
  let samples: number[] = [];
  let lastFrame: number | null = null;
  let lastInput = Number.NEGATIVE_INFINITY;
  let windowStart: number | null = null;

  const flush = () => {
    const summary = summarise(renderer, samples);
    samples = [];
    windowStart = null;
    if (summary !== null) reporter.report(summary);
  };

  return {
    input(at) {
      lastInput = at;
    },
    frame(at) {
      const active = at - lastInput <= activeAfterInputMs;
      if (active && lastFrame !== null && samples.length < maxSamples) {
        samples.push(at - lastFrame);
        windowStart ??= at;
      }
      lastFrame = active ? at : null;
      if (windowStart !== null && at - windowStart >= reportEveryMs) flush();
      return active;
    },
    flush,
  };
}
