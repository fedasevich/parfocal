import { shownRoute, useRenderWorker } from "../../browser/page/pan-harness.ts";
import { type RenderWorkerLike, spawnRenderWorker } from "../../src/custom-webgpu/index.ts";
import type { RenderRequest, RenderResponse } from "../../src/custom-webgpu/protocol.ts";
import type { RendererRouteId } from "../../src/index.ts";

export type RouteGpuSource = "timer-query" | "gl-fence" | "submitted-work-done" | "worker-drawn";

export interface RouteGpuFrames {
  readonly source: RouteGpuSource;
  readonly frames: number;
  readonly medianMs: number;
  readonly p95Ms: number;
  readonly worstMs: number;
}

export interface RouteBench {
  gpuFrames(route: RendererRouteId, warmup: number, frames: number): Promise<RouteGpuFrames>;
  uncapturedGpuErrors(): number;
}

declare global {
  interface Window {
    routeBench: RouteBench;
  }
}

type FrameRequest = Extract<RenderRequest, { type: "frame" }>;

interface GpuQueueLike {
  onSubmittedWorkDone(): Promise<void>;
}

interface WebGpuDeck {
  redraw(reason: string): void;
  readonly device?: { submit?: () => void; readonly handle?: { readonly queue?: GpuQueueLike } };
}

let tracked: RenderWorkerLike | null = null;
let lastFrame: FrameRequest | null = null;
let replayId = 0;
const waiting = new Map<number, () => void>();

function copyFrame(message: FrameRequest): FrameRequest {
  return { ...message, frame: { ...message.frame, tiles: message.frame.tiles.slice(0) } };
}

function spawnTracked(): RenderWorkerLike {
  const inner = spawnRenderWorker();
  const listeners: ((event: MessageEvent<RenderResponse>) => void)[] = [];
  inner.addEventListener("message", (event: MessageEvent<RenderResponse>) => {
    const data = event.data;
    if (data.type === "drawn" && data.id < 0) {
      waiting.get(data.id)?.();
      waiting.delete(data.id);
      return;
    }
    for (const listener of listeners) listener(event);
  });
  tracked = inner;
  lastFrame = null;
  const wrapper: RenderWorkerLike = {
    postMessage(message: RenderRequest, transfer: Transferable[]) {
      if (message.type === "frame") lastFrame = copyFrame(message);
      inner.postMessage(message, transfer);
    },
    addEventListener(type: "message" | "error", listener: (event: never) => void) {
      if (type === "message")
        listeners.push(listener as (event: MessageEvent<RenderResponse>) => void);
      else inner.addEventListener("error", listener as (event: ErrorEvent) => void);
    },
    terminate() {
      inner.terminate();
      if (tracked === inner) tracked = null;
    },
  };
  return wrapper;
}

useRenderWorker(spawnTracked);

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
}

function summary(source: RouteGpuSource, samples: readonly number[]): RouteGpuFrames {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    source,
    frames: sorted.length,
    medianMs: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    worstMs: sorted.at(-1) ?? 0,
  };
}

async function deckWebGpuFrame(deck: WebGpuDeck): Promise<number> {
  const queue = deck.device?.handle?.queue;
  if (queue === undefined) throw new Error("The deck.gl WebGPU route has no device queue");
  const started = performance.now();
  deck.redraw("route-bench");
  deck.device?.submit?.();
  await queue.onSubmittedWorkDone();
  return performance.now() - started;
}

function customFrame(): Promise<number> {
  const worker = tracked;
  const frame = lastFrame;
  if (worker === null || frame === null) {
    return Promise.reject(new Error("The custom WebGPU route has sent no frame yet"));
  }
  replayId -= 1;
  const id = replayId;
  const replay = copyFrame({ ...frame, id });
  return new Promise((resolve) => {
    const started = performance.now();
    waiting.set(id, () => resolve(performance.now() - started));
    worker.postMessage(replay, [replay.frame.tiles]);
  });
}

async function sampled(
  warmup: number,
  frames: number,
  sample: () => Promise<number>,
): Promise<number[]> {
  for (let frame = 0; frame < warmup; frame++) await sample();
  const samples: number[] = [];
  for (let frame = 0; frame < frames; frame++) samples.push(await sample());
  return samples;
}

async function gpuFrames(
  route: RendererRouteId,
  warmup: number,
  frames: number,
): Promise<RouteGpuFrames> {
  if (route === "viv") {
    const viv = await window.frameBench.gpuFrames(warmup, frames);
    return {
      source: viv.source === "timer-query" ? "timer-query" : "gl-fence",
      frames: viv.frames,
      medianMs: viv.medianMs,
      p95Ms: viv.p95Ms,
      worstMs: viv.worstMs,
    };
  }
  if (route === "deck-webgpu") {
    const shown = shownRoute() as unknown as { deck?: WebGpuDeck } | null;
    const deck = shown?.deck;
    if (deck === undefined) throw new Error("The deck.gl WebGPU route is not open");
    return summary(
      "submitted-work-done",
      await sampled(warmup, frames, () => deckWebGpuFrame(deck)),
    );
  }
  return summary("worker-drawn", await sampled(warmup, frames, customFrame));
}

function uncapturedGpuErrors(): number {
  const shown = shownRoute() as unknown as { uncapturedGpuErrors?: () => number } | null;
  return shown?.uncapturedGpuErrors?.() ?? 0;
}

window.routeBench = { gpuFrames, uncapturedGpuErrors };
