import "../../j2k-bench/page/j2k-bench-harness.ts";
import { shownRoute } from "../../browser/page/pan-harness.ts";

export interface GpuFrames {
  readonly source: "timer-query" | "fence";
  readonly frames: number;
  readonly medianMs: number;
  readonly p95Ms: number;
  readonly worstMs: number;
  readonly fenceMedianMs: number;
}

export interface FrameBench {
  gpuFrames(warmup: number, frames: number): Promise<GpuFrames>;
}

declare global {
  interface Window {
    frameBench: FrameBench;
  }
}

interface TimerQueryExtension {
  readonly TIME_ELAPSED_EXT: number;
  readonly GPU_DISJOINT_EXT: number;
}

interface Redrawable {
  readonly deck: { redraw(reason: string): void; readonly device?: unknown };
}

const yieldChannel = new MessageChannel();

function yieldTask(): Promise<void> {
  return new Promise((resolve) => {
    yieldChannel.port1.onmessage = () => resolve();
    yieldChannel.port2.postMessage(null);
  });
}

async function fenceWait(gl: WebGL2RenderingContext): Promise<void> {
  const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  if (fence === null) throw new Error("The context made no fence");
  gl.flush();
  while (gl.clientWaitSync(fence, 0, 0) === gl.TIMEOUT_EXPIRED) await yieldTask();
  gl.deleteSync(fence);
}

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
}

function shown(): { deck: Redrawable["deck"]; gl: WebGL2RenderingContext } {
  const route = shownRoute() as unknown as Redrawable | null;
  if (route === null) throw new Error("No slide is open");
  const gl = (route.deck.device as { gl?: WebGL2RenderingContext } | undefined)?.gl;
  if (gl === undefined) throw new Error("The route has no WebGL2 context");
  return { deck: route.deck, gl };
}

async function sampleFrame(
  deck: Redrawable["deck"],
  gl: WebGL2RenderingContext,
  timer: TimerQueryExtension | null,
): Promise<{ fenceMs: number; queryMs: number | null }> {
  const query = timer === null ? null : gl.createQuery();
  const started = performance.now();
  if (query !== null && timer !== null) gl.beginQuery(timer.TIME_ELAPSED_EXT, query);
  deck.redraw("frame-bench");
  if (query !== null && timer !== null) gl.endQuery(timer.TIME_ELAPSED_EXT);
  await fenceWait(gl);
  const fenceMs = performance.now() - started;
  let queryMs: number | null = null;
  if (query !== null && timer !== null) {
    const disjoint = gl.getParameter(timer.GPU_DISJOINT_EXT) === true;
    if (!disjoint && gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE) === true) {
      queryMs = Number(gl.getQueryParameter(query, gl.QUERY_RESULT)) / 1e6;
    }
    gl.deleteQuery(query);
  }
  return { fenceMs, queryMs };
}

async function gpuFrames(warmup: number, frames: number): Promise<GpuFrames> {
  const { deck, gl } = shown();
  const timer = gl.getExtension("EXT_disjoint_timer_query_webgl2") as TimerQueryExtension | null;
  for (let frame = 0; frame < warmup; frame++) await sampleFrame(deck, gl, timer);
  const query: number[] = [];
  const fence: number[] = [];
  for (let frame = 0; frame < frames; frame++) {
    const sample = await sampleFrame(deck, gl, timer);
    fence.push(sample.fenceMs);
    if (sample.queryMs !== null) query.push(sample.queryMs);
  }
  const useQuery = query.length >= frames / 2;
  const picked = [...(useQuery ? query : fence)].sort((a, b) => a - b);
  const fenceSorted = [...fence].sort((a, b) => a - b);
  return {
    source: useQuery ? "timer-query" : "fence",
    frames: picked.length,
    medianMs: percentile(picked, 0.5),
    p95Ms: percentile(picked, 0.95),
    worstMs: picked.at(-1) ?? 0,
    fenceMedianMs: percentile(fenceSorted, 0.5),
  };
}

window.frameBench = { gpuFrames };
