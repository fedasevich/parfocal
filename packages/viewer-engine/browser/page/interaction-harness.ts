import {
  createViewerEngine,
  type EngineSlide,
  messageTasks,
  type RendererRoute,
} from "../../src/index.ts";
import { type RegionPass, startRegionPass } from "./region-pass.ts";

export type PauseMode = "no-job" | "unpaused" | "paused";

export interface InteractionRunOptions {
  readonly mode: PauseMode;
  readonly panMs: number;
  readonly sliceMs: number;
  readonly regions: number;
  readonly warmupMs: number;
  readonly settlePanMs: number;
  readonly panStepPx: number;
}

export interface InteractionRunReport {
  readonly mode: PauseMode;
  readonly frames: number;
  readonly panMs: number;
  readonly fps: number;
  readonly frameMs: {
    readonly median: number;
    readonly p95: number;
    readonly p99: number;
    readonly worst: number;
  };
  readonly framesOver20Ms: number;
  readonly framesOver33Ms: number;
  readonly regionsBeforePan: number;
  readonly regionsDuringPan: number;
  readonly resumeDelayMs: number | null;
  readonly regionsAfterRest: number;
}

export interface InteractionHarness {
  run(options: InteractionRunOptions): Promise<InteractionRunReport>;
}

declare global {
  interface Window {
    interactionHarness: InteractionHarness;
  }
}

const slide: EngineSlide = {
  id: "interaction-harness",
  width: 80_000,
  height: 60_000,
  micronsPerPixel: 0.25,
  close: () => {},
};

const stillRoute: RendererRoute = {
  showSlide: () => {},
  setCamera: () => {},
  setOverlays: () => {},
  invalidateOverlay: () => {},
  destroy: () => {},
};

function viewer(): HTMLElement {
  const element = document.getElementById("viewer");
  if (element === null) throw new Error("The interaction page has no #viewer element");
  return element;
}

function nextTask(): Promise<void> {
  return new Promise((resolve) => {
    messageTasks.run(resolve);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function nextFrame(): Promise<number> {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

function percentile(sorted: readonly number[], share: number): number {
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * share) - 1);
  return sorted[Math.max(0, index)] ?? 0;
}

async function panFrames(
  step: () => void,
  panMs: number,
): Promise<{ readonly deltas: number[]; readonly lastPan: number }> {
  const deltas: number[] = [];
  step();
  let previous = await nextFrame();
  const start = previous;
  let lastPan = performance.now();
  while (previous - start < panMs) {
    const time = await nextFrame();
    deltas.push(time - previous);
    previous = time;
    step();
    lastPan = performance.now();
  }
  return { deltas, lastPan };
}

async function run(options: InteractionRunOptions): Promise<InteractionRunReport> {
  const engine = createViewerEngine({
    createRenderer: () => stillRoute,
    openSlide: () => Promise.resolve(slide),
    reducedMotion: () => false,
  });
  engine.mount(viewer());
  await engine.openSlide({ id: slide.id });
  engine.setCamera({ x: 20_000, y: 30_000, zoom: -3 });
  await sleep(300);

  const pass: RegionPass | null =
    options.mode === "no-job"
      ? null
      : startRegionPass({
          regions: options.regions,
          sliceMs: options.sliceMs,
          now: () => performance.now(),
          yieldToMain: nextTask,
          gate: options.mode === "paused" ? engine.interaction : undefined,
        });

  await panFrames(() => engine.panBy(options.panStepPx, 0), options.settlePanMs);
  await sleep(options.warmupMs);
  const regionsBeforePan = pass?.completed() ?? 0;
  const { deltas, lastPan } = await panFrames(
    () => engine.panBy(options.panStepPx, 0),
    options.panMs,
  );
  const regionsAtEnd = pass?.completed() ?? 0;

  let resumeDelayMs: number | null = null;
  if (pass !== null && options.mode === "paused") {
    const deadline = performance.now() + 2000;
    while (pass.completed() === regionsAtEnd && performance.now() < deadline) await sleep(5);
    if (pass.completed() > regionsAtEnd) resumeDelayMs = performance.now() - lastPan;
  }
  const regionsAfterRest = pass?.completed() ?? 0;
  pass?.stop();
  await pass?.finished;
  engine.dispose();

  const sorted = [...deltas].sort((a, b) => a - b);
  const total = deltas.reduce((sum, delta) => sum + delta, 0);
  return {
    mode: options.mode,
    frames: deltas.length,
    panMs: total,
    fps: (deltas.length / total) * 1000,
    frameMs: {
      median: percentile(sorted, 0.5),
      p95: percentile(sorted, 0.95),
      p99: percentile(sorted, 0.99),
      worst: sorted.at(-1) ?? 0,
    },
    framesOver20Ms: deltas.filter((delta) => delta > 20).length,
    framesOver33Ms: deltas.filter((delta) => delta > 33).length,
    regionsBeforePan,
    regionsDuringPan: regionsAtEnd - regionsBeforePan,
    resumeDelayMs,
    regionsAfterRest,
  };
}

window.interactionHarness = { run };
