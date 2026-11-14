import * as ort from "onnxruntime-web/webgpu";
import type { SamProvider } from "../../src/index.ts";
import { wasmMjsUrl, wasmUrl } from "./ort-wasm-urls.js";
import { bestMultimask, maskIou, maxAbsDifference, planeIou } from "./parity-measures.ts";

export interface ParityRequest {
  readonly provider: SamProvider;
  readonly modelsUrl: string;
  readonly fixturesUrl: string;
  readonly encoder: string;
  readonly decoder: string;
  readonly aisDecoders: readonly string[];
}

interface ManifestPatch {
  readonly name: string;
  readonly height: number;
  readonly width: number;
  readonly pixels: string;
  readonly embeddings: string;
  readonly maps: string;
  readonly mapsDims: readonly number[];
  readonly masks: string;
  readonly clicks: readonly (readonly [number, number])[];
}

export interface ParityManifest {
  readonly thresholds: { readonly clickMeanIou: number; readonly aisMeanForegroundIou: number };
  readonly checkpoints: Readonly<Record<string, string>>;
  readonly graphs: Readonly<Record<string, string>>;
  readonly versions: Readonly<Record<string, string>>;
  readonly patches: readonly ManifestPatch[];
}

export interface AisParity {
  readonly graph: string;
  readonly fromTorchEmbeddings: { readonly maxAbs: number; readonly foregroundIous: number[] };
  readonly fromBrowserEmbeddings: { readonly maxAbs: number; readonly foregroundIous: number[] };
  readonly runMs: number[];
}

export interface ParityReport {
  readonly provider: SamProvider;
  readonly userAgent: string;
  readonly crossOriginIsolated: boolean;
  readonly adapter: { vendor: string; architecture: string } | null;
  readonly ortVersion: string;
  readonly encoder: string;
  readonly decoder: string;
  readonly manifest: Omit<ParityManifest, "patches">;
  readonly patches: number;
  readonly embeddingMaxAbs: number[];
  readonly clickIous: number[];
  readonly encodeMs: number[];
  readonly decodeMs: number[];
  readonly ais: AisParity[];
}

declare global {
  interface Window {
    samParity: { run(request: ParityRequest): Promise<ParityReport> };
  }
}

ort.env.wasm.wasmPaths = { mjs: wasmMjsUrl, wasm: wasmUrl };
ort.env.wasm.numThreads = navigator.hardwareConcurrency;

const imageSize = 1024;
const embedDim = 256;
const embedSize = 64;
const maskInputSize = 256;
const foregroundThreshold = 0.5;

interface GpuAdapter {
  readonly info: { vendor: string; architecture: string };
}

async function gpuAdapter(): Promise<{ vendor: string; architecture: string } | null> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<GpuAdapter | null> } })
    .gpu;
  const adapter = await gpu?.requestAdapter();
  if (!adapter) return null;
  return { vendor: adapter.info.vendor, architecture: adapter.info.architecture };
}

async function fetchBuffer(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response.arrayBuffer();
}

async function floats(url: string): Promise<Float32Array> {
  return new Float32Array(await fetchBuffer(url));
}

async function timed<T>(run: () => Promise<T>): Promise<[T, number]> {
  const started = performance.now();
  const result = await run();
  return [result, performance.now() - started];
}

async function session(request: ParityRequest, graph: string): Promise<ort.InferenceSession> {
  const bytes = new Uint8Array(await fetchBuffer(`${request.modelsUrl}/${graph}`));
  return ort.InferenceSession.create(bytes, { executionProviders: [request.provider] });
}

function embeddingTensor(values: Float32Array): ort.Tensor {
  return new ort.Tensor("float32", values, [1, embedDim, embedSize, embedSize]);
}

function clickFeeds(
  embeddings: ort.Tensor,
  click: readonly [number, number],
  patch: ManifestPatch,
): Record<string, ort.Tensor> {
  return {
    image_embeddings: embeddings,
    point_coords: new ort.Tensor(
      "float32",
      Float32Array.from([click[0], click[1], 0, 0]),
      [1, 2, 2],
    ),
    point_labels: new ort.Tensor("float32", Float32Array.from([1, -1]), [1, 2]),
    mask_input: new ort.Tensor("float32", new Float32Array(maskInputSize ** 2), [
      1,
      1,
      maskInputSize,
      maskInputSize,
    ]),
    has_mask_input: new ort.Tensor("float32", Float32Array.from([0]), [1]),
    orig_im_size: new ort.Tensor("float32", Float32Array.from([patch.height, patch.width]), [2]),
  };
}

async function outputData(tensor: ort.Tensor | undefined, name: string): Promise<Float32Array> {
  if (!tensor) throw new Error(`the graph gave no ${name}`);
  return (await tensor.getData()) as Float32Array;
}

async function run(request: ParityRequest): Promise<ParityReport> {
  const adapter = await gpuAdapter();
  const manifest = JSON.parse(
    new TextDecoder().decode(await fetchBuffer(`${request.fixturesUrl}/manifest.json`)),
  ) as ParityManifest;
  const encoder = await session(request, request.encoder);
  const decoder = await session(request, request.decoder);
  const embeddingMaxAbs: number[] = [];
  const clickIous: number[] = [];
  const encodeMs: number[] = [];
  const decodeMs: number[] = [];
  const browserEmbeddings: Float32Array[] = [];

  for (const patch of manifest.patches) {
    const pixels = await floats(`${request.fixturesUrl}/${patch.pixels}`);
    const expected = await floats(`${request.fixturesUrl}/${patch.embeddings}`);
    const [encoded, encodeElapsed] = await timed(() =>
      encoder.run({
        pixel_values: new ort.Tensor("float32", pixels, [1, 3, imageSize, imageSize]),
      }),
    );
    encodeMs.push(encodeElapsed);
    const embeddings = Float32Array.from(
      await outputData(encoded["image_embeddings"], "image_embeddings"),
    );
    browserEmbeddings.push(embeddings);
    embeddingMaxAbs.push(maxAbsDifference(expected, embeddings));

    const masks = new Uint8Array(await fetchBuffer(`${request.fixturesUrl}/${patch.masks}`));
    const plane = patch.height * patch.width;
    const tensor = embeddingTensor(embeddings);
    for (const [index, click] of patch.clicks.entries()) {
      const [outputs, elapsed] = await timed(() => decoder.run(clickFeeds(tensor, click, patch)));
      decodeMs.push(elapsed);
      const scores = await outputData(outputs["iou_predictions"], "iou_predictions");
      const logits = await outputData(outputs["masks"], "masks");
      const best = bestMultimask(scores);
      const expectedMask = masks.subarray(index * plane, (index + 1) * plane);
      clickIous.push(maskIou(expectedMask, logits, best * plane, 0));
    }
  }
  await encoder.release();
  await decoder.release();

  const ais: AisParity[] = [];
  for (const graph of request.aisDecoders) {
    const decoderSession = await session(request, graph);
    const fromTorch = { maxAbs: 0, foregroundIous: [] as number[] };
    const fromBrowser = { maxAbs: 0, foregroundIous: [] as number[] };
    const runMs: number[] = [];
    for (const [number, patch] of manifest.patches.entries()) {
      const expected = await floats(`${request.fixturesUrl}/${patch.maps}`);
      const plane = (patch.mapsDims[2] ?? 0) * (patch.mapsDims[3] ?? 0);
      const torchEmbeddings = await floats(`${request.fixturesUrl}/${patch.embeddings}`);
      const own = browserEmbeddings[number];
      if (!own) throw new Error(`no browser embeddings for ${patch.name}`);
      for (const [values, into] of [
        [torchEmbeddings, fromTorch],
        [own, fromBrowser],
      ] as const) {
        const [outputs, elapsed] = await timed(() =>
          decoderSession.run({ image_embeddings: embeddingTensor(values) }),
        );
        runMs.push(elapsed);
        const maps = await outputData(outputs["maps"], "maps");
        into.maxAbs = Math.max(into.maxAbs, maxAbsDifference(expected, maps));
        into.foregroundIous.push(planeIou(expected, maps, plane, foregroundThreshold));
      }
    }
    await decoderSession.release();
    ais.push({ graph, fromTorchEmbeddings: fromTorch, fromBrowserEmbeddings: fromBrowser, runMs });
  }

  const { patches, ...rest } = manifest;
  return {
    provider: request.provider,
    userAgent: navigator.userAgent,
    crossOriginIsolated: self.crossOriginIsolated,
    adapter,
    ortVersion: ort.env.versions.web ?? "unknown",
    encoder: request.encoder,
    decoder: request.decoder,
    manifest: rest,
    patches: patches.length,
    embeddingMaxAbs,
    clickIous,
    encodeMs,
    decodeMs,
    ais,
  };
}

window.samParity = { run };
