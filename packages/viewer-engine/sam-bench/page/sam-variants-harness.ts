import * as ort from "onnxruntime-web/webgpu";
import type { SamProvider } from "../../src/index.ts";
import { embeddingWindow } from "../../src/sam/embedding-window.ts";
import { wasmMjsUrl, wasmUrl } from "./ort-wasm-urls.js";

export interface SamBenchRequest {
  readonly provider: SamProvider;
  readonly modelsUrl: string;
  readonly encoder: string;
  readonly decoder: string;
  readonly windowDecoder?: string;
  readonly aisDecoders: readonly string[];
  readonly encodeRuns: number;
  readonly decodeRuns: number;
  readonly aisRuns: number;
}

export interface AisTiming {
  readonly graph: string;
  readonly bytes: number;
  readonly sessionMs: number;
  readonly runsMs: number[];
  readonly outputDims: readonly number[];
  readonly maxAbsFromFirst: number;
  readonly foregroundIouWithFirst: number;
  readonly foregroundShare: number;
}

export interface SamBenchReport {
  readonly provider: SamProvider;
  readonly userAgent: string;
  readonly crossOriginIsolated: boolean;
  readonly threads: number;
  readonly adapter: { vendor: string; architecture: string } | null;
  readonly encoder: string;
  readonly encoderBytes: number;
  readonly decoderBytes: number;
  readonly decoderSessionMs: number;
  readonly encoderSessionMs: number;
  readonly encodeMs: number[];
  readonly decodeMs: number[];
  readonly window: WindowTiming | null;
  readonly ais: AisTiming[];
}

export interface WindowTiming {
  readonly graph: string;
  readonly bytes: number;
  readonly sessionMs: number;
  readonly runsMs: number[];
  readonly lowResDims: readonly number[];
}

declare global {
  interface Window {
    samBench: { run(request: SamBenchRequest): Promise<SamBenchReport> };
  }
}

ort.env.wasm.wasmPaths = { mjs: wasmMjsUrl, wasm: wasmUrl };
ort.env.wasm.numThreads = navigator.hardwareConcurrency;

const imageSize = 1024;
const maskInputSize = 256;

async function fetchBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

async function timed<T>(run: () => Promise<T>): Promise<[T, number]> {
  const started = performance.now();
  const result = await run();
  return [result, performance.now() - started];
}

function seededPixels(): Float32Array {
  const pixels = new Float32Array(3 * imageSize * imageSize);
  let state = 20261106;
  for (let index = 0; index < pixels.length; index++) {
    state = (state * 1664525 + 1013904223) >>> 0;
    pixels[index] = state / 2 ** 31 - 1;
  }
  return pixels;
}

async function gpuAdapter(): Promise<{ vendor: string; architecture: string } | null> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<GpuAdapter | null> } })
    .gpu;
  const adapter = await gpu?.requestAdapter();
  if (!adapter) return null;
  return { vendor: adapter.info.vendor, architecture: adapter.info.architecture };
}

interface GpuAdapter {
  readonly info: { vendor: string; architecture: string };
}

function clickAt(run: number): { x: number; y: number } {
  return { x: 200 + ((run * 97) % 600), y: 300 + ((run * 53) % 500) };
}

function windowFeeds(embeddings: ort.Tensor, run: number): Record<string, ort.Tensor> {
  const { x, y } = clickAt(run);
  const window = embeddingWindow({ points: [{ x, y, positive: true }] });
  if (window === null) throw new Error(`the bench click ${x}, ${y} has no window`);
  const { orig_im_size: _, ...feeds } = clickFeeds(embeddings, run);
  return {
    ...feeds,
    window_origin: new ort.Tensor("float32", Float32Array.from([window.x, window.y]), [2]),
  };
}

async function timeWindow(
  request: SamBenchRequest,
  embeddings: ort.Tensor,
  executionProviders: SamProvider[],
): Promise<WindowTiming | null> {
  const graph = request.windowDecoder;
  if (graph === undefined) return null;
  const bytes = await fetchBytes(`${request.modelsUrl}/${graph}`);
  const [session, sessionMs] = await timed(() =>
    ort.InferenceSession.create(bytes, { executionProviders }),
  );
  const runsMs: number[] = [];
  let lowResDims: readonly number[] = [];
  for (let index = 0; index < request.decodeRuns; index++) {
    const feeds = windowFeeds(embeddings, index);
    const [outputs, elapsed] = await timed(() => session.run(feeds));
    lowResDims = outputs["low_res_masks"]?.dims ?? [];
    runsMs.push(elapsed);
  }
  await session.release();
  return { graph, bytes: bytes.byteLength, sessionMs, runsMs, lowResDims };
}

function clickFeeds(embeddings: ort.Tensor, run: number): Record<string, ort.Tensor> {
  const { x, y } = clickAt(run);
  return {
    image_embeddings: embeddings,
    point_coords: new ort.Tensor("float32", Float32Array.from([x, y, 0, 0]), [1, 2, 2]),
    point_labels: new ort.Tensor("float32", Float32Array.from([1, -1]), [1, 2]),
    mask_input: new ort.Tensor("float32", new Float32Array(maskInputSize ** 2), [
      1,
      1,
      maskInputSize,
      maskInputSize,
    ]),
    has_mask_input: new ort.Tensor("float32", Float32Array.from([0]), [1]),
    orig_im_size: new ort.Tensor("float32", Float32Array.from([imageSize, imageSize]), [2]),
  };
}

function compareMaps(
  first: Float32Array,
  other: Float32Array,
  plane: number,
): [number, number, number] {
  let maxAbs = 0;
  let both = 0;
  let either = 0;
  let foreground = 0;
  for (let index = 0; index < first.length; index++) {
    maxAbs = Math.max(maxAbs, Math.abs((first[index] ?? 0) - (other[index] ?? 0)));
    if (index < plane) {
      const a = (first[index] ?? 0) > 0.5;
      const b = (other[index] ?? 0) > 0.5;
      if (b) foreground++;
      if (a && b) both++;
      if (a || b) either++;
    }
  }
  return [maxAbs, either === 0 ? 1 : both / either, foreground / plane];
}

async function run(request: SamBenchRequest): Promise<SamBenchReport> {
  const executionProviders = [request.provider];
  const adapter = await gpuAdapter();
  const decoderBytes = await fetchBytes(`${request.modelsUrl}/${request.decoder}`);
  const encoderBytes = await fetchBytes(`${request.modelsUrl}/${request.encoder}`);
  const [decoder, decoderSessionMs] = await timed(() =>
    ort.InferenceSession.create(decoderBytes, { executionProviders }),
  );
  const [encoder, encoderSessionMs] = await timed(() =>
    ort.InferenceSession.create(encoderBytes, { executionProviders }),
  );
  const input = new ort.Tensor("float32", seededPixels(), [1, 3, imageSize, imageSize]);
  const inputName = encoder.inputNames[0] ?? "pixel_values";
  const encodeMs: number[] = [];
  let embeddings: ort.Tensor | undefined;
  for (let index = 0; index < request.encodeRuns; index++) {
    const [outputs, elapsed] = await timed(() => encoder.run({ [inputName]: input }));
    embeddings = outputs["image_embeddings"];
    encodeMs.push(elapsed);
  }
  if (!embeddings) throw new Error("the encoder gave no image_embeddings");
  const decodeMs: number[] = [];
  for (let index = 0; index < request.decodeRuns; index++) {
    const feeds = clickFeeds(embeddings, index);
    const [, elapsed] = await timed(() => decoder.run(feeds));
    decodeMs.push(elapsed);
  }
  await encoder.release();
  await decoder.release();
  const window = await timeWindow(request, embeddings, executionProviders);

  const ais: AisTiming[] = [];
  let firstMaps: Float32Array | undefined;
  for (const graph of request.aisDecoders) {
    const bytes = await fetchBytes(`${request.modelsUrl}/${graph}`);
    const [session, sessionMs] = await timed(() =>
      ort.InferenceSession.create(bytes, { executionProviders }),
    );
    const runsMs: number[] = [];
    let maps: ort.Tensor | undefined;
    for (let index = 0; index < request.aisRuns; index++) {
      const [outputs, elapsed] = await timed(() => session.run({ image_embeddings: embeddings }));
      maps = outputs["maps"];
      runsMs.push(elapsed);
    }
    await session.release();
    if (!maps) throw new Error(`${graph} gave no maps`);
    const values = maps.data as Float32Array;
    firstMaps ??= values;
    const plane = (maps.dims[2] ?? 0) * (maps.dims[3] ?? 0);
    const [maxAbsFromFirst, foregroundIouWithFirst, foregroundShare] = compareMaps(
      firstMaps,
      values,
      plane,
    );
    ais.push({
      graph,
      bytes: bytes.byteLength,
      sessionMs,
      runsMs,
      outputDims: maps.dims,
      maxAbsFromFirst,
      foregroundIouWithFirst,
      foregroundShare,
    });
  }

  return {
    provider: request.provider,
    userAgent: navigator.userAgent,
    crossOriginIsolated,
    threads: ort.env.wasm.numThreads ?? 0,
    adapter,
    encoder: request.encoder,
    encoderBytes: encoderBytes.byteLength,
    decoderBytes: decoderBytes.byteLength,
    decoderSessionMs,
    encoderSessionMs,
    encodeMs,
    decodeMs,
    window,
    ais,
  };
}

window.samBench = { run };
