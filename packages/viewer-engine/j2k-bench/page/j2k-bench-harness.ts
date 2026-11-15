import "../../browser/page/pan-harness.ts";
import { createWorkerRegionReader } from "../../src/decode/worker-reader.ts";
import type { SlideFormatId } from "../../src/index.ts";
import type { CodecReply, CodecRequest } from "./codec.worker.ts";

export interface GpuInfo {
  readonly renderer: string | null;
  readonly vendor: string | null;
  readonly devicePixelRatio: number;
  readonly hardwareConcurrency: number;
  readonly refreshIntervalMs: number;
}

export interface TileRequest {
  readonly url: string;
  readonly formatId: SlideFormatId;
  readonly level: number;
  readonly tileSize: number;
  readonly tiles: readonly (readonly [number, number])[];
  readonly repeats: number;
}

export interface TileReport {
  readonly coldFirstMs: number;
  readonly warmMs: readonly number[];
  readonly error: string | null;
}

export interface ThroughputRequest extends TileRequest {
  readonly workers: number;
}

export interface ThroughputReport {
  readonly workers: number;
  readonly tiles: number;
  readonly coldMs: number;
  readonly warmMs: number;
  readonly error: string | null;
}

export interface FrameWindow {
  readonly frames: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly worstMs: number;
  readonly over33Ms: number;
}

export interface J2kBench {
  gpu(): Promise<GpuInfo>;
  tiles(request: TileRequest): Promise<TileReport>;
  throughput(request: ThroughputRequest): Promise<ThroughputReport>;
  codec(tiles: readonly string[], repeats: number, reduce: number): Promise<CodecReply>;
  startFrames(): void;
  stopFrames(motionMs: number): { motion: FrameWindow; settle: FrameWindow };
}

declare global {
  interface Window {
    j2kBench: J2kBench;
  }
}

function nextFrame(): Promise<number> {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
}

function frameWindow(intervals: readonly number[]): FrameWindow {
  const sorted = [...intervals].sort((a, b) => a - b);
  return {
    frames: sorted.length,
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    worstMs: sorted.at(-1) ?? 0,
    over33Ms: sorted.filter((value) => value > 33.4).length,
  };
}

async function gpu(): Promise<GpuInfo> {
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl2");
  const extension = gl?.getExtension("WEBGL_debug_renderer_info") ?? null;
  const stamps: number[] = [];
  for (let frame = 0; frame < 60; frame++) stamps.push(await nextFrame());
  const intervals = stamps.slice(1).map((stamp, index) => stamp - (stamps[index] ?? stamp));
  return {
    renderer: gl && extension ? String(gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)) : null,
    vendor: gl && extension ? String(gl.getParameter(extension.UNMASKED_VENDOR_WEBGL)) : null,
    devicePixelRatio: window.devicePixelRatio,
    hardwareConcurrency: navigator.hardwareConcurrency,
    refreshIntervalMs: frameWindow(intervals).p50Ms,
  };
}

function regionOf(request: TileRequest, tile: readonly [number, number]) {
  const [x, y] = tile;
  const size = request.tileSize;
  return {
    region: {
      backing: request.level,
      residual: 1,
      window: [x * size, y * size, x * size + size, y * size + size] as const,
      width: size,
      height: size,
    },
    centre: { x: x * size, y: y * size },
  };
}

async function tiles(request: TileRequest): Promise<TileReport> {
  const reader = createWorkerRegionReader({
    request: { formatId: request.formatId, url: request.url },
    size: 1,
  });
  const warmMs: number[] = [];
  let coldFirstMs = 0;
  try {
    await reader.ready;
    for (const [index, tile] of request.tiles.entries()) {
      const { region, centre } = regionOf(request, tile);
      const coldStarted = performance.now();
      await reader.read(region, centre);
      if (index === 0) coldFirstMs = performance.now() - coldStarted;
    }
    for (let repeat = 0; repeat < request.repeats; repeat++) {
      for (const tile of request.tiles) {
        const { region, centre } = regionOf(request, tile);
        const started = performance.now();
        await reader.read(region, centre);
        warmMs.push(performance.now() - started);
      }
    }
    return { coldFirstMs, warmMs, error: null };
  } catch (error) {
    return { coldFirstMs, warmMs, error: error instanceof Error ? error.message : String(error) };
  } finally {
    reader.dispose();
  }
}

async function throughput(request: ThroughputRequest): Promise<ThroughputReport> {
  const reader = createWorkerRegionReader({
    request: { formatId: request.formatId, url: request.url },
    size: request.workers,
  });
  const all = () =>
    Promise.all(
      request.tiles.map((tile) => {
        const { region, centre } = regionOf(request, tile);
        return reader.read(region, centre);
      }),
    );
  try {
    await reader.ready;
    const coldStarted = performance.now();
    await all();
    const coldMs = performance.now() - coldStarted;
    let warmMs = Number.POSITIVE_INFINITY;
    for (let repeat = 0; repeat < request.repeats; repeat++) {
      const started = performance.now();
      await all();
      warmMs = Math.min(warmMs, performance.now() - started);
    }
    return { workers: request.workers, tiles: request.tiles.length, coldMs, warmMs, error: null };
  } catch (error) {
    return {
      workers: request.workers,
      tiles: request.tiles.length,
      coldMs: 0,
      warmMs: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    reader.dispose();
  }
}

function codec(tiles: readonly string[], repeats: number, reduce: number): Promise<CodecReply> {
  const buffers = tiles.map(
    (tile) => Uint8Array.from(atob(tile), (character) => character.charCodeAt(0)).buffer,
  );
  const worker = new Worker(new URL("./codec.worker.ts", import.meta.url), { type: "module" });
  return new Promise<CodecReply>((resolve, reject) => {
    worker.addEventListener("message", (event: MessageEvent<CodecReply>) => resolve(event.data));
    worker.addEventListener("error", (event) => reject(new Error(event.message)));
    worker.postMessage({ tiles: buffers, repeats, reduce } satisfies CodecRequest);
  }).finally(() => worker.terminate());
}

let stamps: number[] | null = null;

function sample(now: number): void {
  if (stamps === null) return;
  stamps.push(now);
  requestAnimationFrame(sample);
}

function startFrames(): void {
  stamps = [];
  requestAnimationFrame(sample);
}

function stopFrames(motionMs: number): { motion: FrameWindow; settle: FrameWindow } {
  const recorded = stamps ?? [];
  stamps = null;
  const first = recorded[0] ?? 0;
  const motion: number[] = [];
  const settle: number[] = [];
  for (let index = 1; index < recorded.length; index++) {
    const stamp = recorded[index] ?? 0;
    const interval = stamp - (recorded[index - 1] ?? stamp);
    (stamp - first <= motionMs ? motion : settle).push(interval);
  }
  return { motion: frameWindow(motion), settle: frameWindow(settle) };
}

window.j2kBench = { gpu, tiles, throughput, codec, startFrames, stopFrames };
