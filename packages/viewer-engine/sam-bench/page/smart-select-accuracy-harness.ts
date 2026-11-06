import {
  bestMask,
  type ModelCache,
  type SamPrompt,
  type SamProvider,
  samFrame,
  samPixels,
  slideToModel,
} from "../../src/index.ts";
import { createInferenceEngine } from "../../src/sam/inference-engine.ts";
import { createOrtRuntime } from "../../src/sam/ort-runtime.ts";

export interface SmokeRequest {
  readonly provider: SamProvider;
  readonly modelsUrl: string;
  readonly fixturesUrl: string;
}

interface Nucleus {
  readonly id: number;
  readonly area: number;
  readonly box: readonly [number, number, number, number];
  readonly realistic: readonly [number, number];
}

interface ManifestPatch {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly rgb: string;
  readonly labels: string;
  readonly nuclei: readonly Nucleus[];
}

interface Manifest {
  readonly seed: number;
  readonly missSigma: number;
  readonly patches: readonly ManifestPatch[];
}

export type Protocol = "ideal" | "realistic" | "box" | "three";

export interface NucleusScore {
  readonly patch: string;
  readonly id: number;
  readonly area: number;
  readonly iou: Readonly<Record<Protocol, number>>;
  readonly threeSteps: readonly number[];
}

export interface SmokeReport {
  readonly provider: SamProvider;
  readonly userAgent: string;
  readonly crossOriginIsolated: boolean;
  readonly adapter: { vendor: string; architecture: string } | null;
  readonly encoderGraph: string;
  readonly seed: number;
  readonly patches: number;
  readonly nuclei: number;
  readonly encodeMs: number[];
  readonly decodeMs: number[];
  readonly scores: NucleusScore[];
}

declare global {
  interface Window {
    smartSmoke: { run(request: SmokeRequest): Promise<SmokeReport> };
  }
}

const side = 1024;
const source = 512;
const scale = side / source;
const correctiveClicks = 2;

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

function networkCache(): ModelCache {
  return {
    async load(url) {
      const bytes = new Uint8Array(await fetchBuffer(url));
      return {
        bytes,
        source: "network",
        downloadedBytes: bytes.length,
        message: "network",
        replacedCorruptEntry: false,
        revalidation: null,
      };
    },
  };
}

function groundTruth(labels: Int32Array, width: number, id: number): Uint8Array {
  const mask = new Uint8Array(side * side);
  for (let y = 0; y < side; y++) {
    const row = Math.floor(y / scale) * width;
    for (let x = 0; x < side; x++) {
      if (labels[row + Math.floor(x / scale)] === id) mask[y * side + x] = 1;
    }
  }
  return mask;
}

function depthOf(inside: Uint8Array): Float32Array {
  const depth = new Float32Array(side * side);
  const far = 1e6;
  for (let i = 0; i < inside.length; i++) depth[i] = inside[i] === 1 ? far : 0;
  const straight = 1;
  const diagonal = Math.SQRT2;
  const at = (x: number, y: number) =>
    x < 0 || y < 0 || x >= side || y >= side ? 0 : (depth[y * side + x] ?? 0);
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const index = y * side + x;
      if (depth[index] === 0) continue;
      depth[index] = Math.min(
        depth[index] ?? far,
        at(x - 1, y) + straight,
        at(x, y - 1) + straight,
        at(x - 1, y - 1) + diagonal,
        at(x + 1, y - 1) + diagonal,
      );
    }
  }
  for (let y = side - 1; y >= 0; y--) {
    for (let x = side - 1; x >= 0; x--) {
      const index = y * side + x;
      if (depth[index] === 0) continue;
      depth[index] = Math.min(
        depth[index] ?? far,
        at(x + 1, y) + straight,
        at(x, y + 1) + straight,
        at(x + 1, y + 1) + diagonal,
        at(x - 1, y + 1) + diagonal,
      );
    }
  }
  return depth;
}

function deepest(inside: Uint8Array): { x: number; y: number } {
  const depth = depthOf(inside);
  let best = 0;
  for (let i = 1; i < depth.length; i++) {
    if ((depth[i] ?? 0) > (depth[best] ?? 0)) best = i;
  }
  return { x: best % side, y: Math.floor(best / side) };
}

function iou(prediction: Uint8Array, truth: Uint8Array): number {
  let both = 0;
  let either = 0;
  for (let i = 0; i < truth.length; i++) {
    const a = prediction[i] === 1;
    const b = truth[i] === 1;
    if (a && b) both++;
    if (a || b) either++;
  }
  return either === 0 ? 1 : both / either;
}

function threshold(logits: Float32Array): Uint8Array {
  const mask = new Uint8Array(logits.length);
  for (let i = 0; i < logits.length; i++) mask[i] = (logits[i] ?? 0) > 0 ? 1 : 0;
  return mask;
}

async function run(request: SmokeRequest): Promise<SmokeReport> {
  const adapter = await gpuAdapter();
  const manifest = JSON.parse(
    new TextDecoder().decode(await fetchBuffer(`${request.fixturesUrl}/manifest.json`)),
  ) as Manifest;
  const engine = createInferenceEngine({
    runtime: createOrtRuntime(navigator.hardwareConcurrency),
    cache: networkCache(),
    modelsUrl: request.modelsUrl,
    hasGpuAdapter: () => Promise.resolve(request.provider === "webgpu" && adapter !== null),
    warm: false,
  });
  const ready = await engine.init();
  if (ready.provider !== request.provider) {
    throw new Error(`Wanted ${request.provider}, the engine started on ${ready.provider}`);
  }
  const encodeMs: number[] = [];
  const decodeMs: number[] = [];
  const scores: NucleusScore[] = [];
  const frame = samFrame({ x: 0, y: 0, width: source, height: source, downsample: 1 });

  const decode = async (id: string, prompt: SamPrompt) => {
    const outcome = await engine.prompt(id, prompt);
    if (outcome.status !== "answer") throw new Error("The prompt was reported stale");
    decodeMs.push(outcome.ms);
    return bestMask(outcome.outputs);
  };
  const model = (x: number, y: number) => slideToModel(frame, { x: x + 0.5, y: y + 0.5 });

  for (const patch of manifest.patches) {
    if (patch.width !== source || patch.height !== source) {
      throw new Error(`${patch.name} is ${patch.width} by ${patch.height}, expected ${source}`);
    }
    const rgb = new Uint8Array(await fetchBuffer(`${request.fixturesUrl}/${patch.rgb}`));
    const labels = new Int32Array(await fetchBuffer(`${request.fixturesUrl}/${patch.labels}`));
    const id = patch.name;
    const encoded = await engine.encode(id, samPixels(rgb, frame));
    encodeMs.push(encoded.ms);

    for (const nucleus of patch.nuclei) {
      const truth = groundTruth(labels, patch.width, nucleus.id);
      const ideal = deepest(truth);
      const idealMask = threshold(
        (
          await decode(id, {
            points: [{ ...model(ideal.x / scale, ideal.y / scale), positive: true }],
          })
        ).logits,
      );

      const realisticPoint = {
        ...model(nucleus.realistic[0], nucleus.realistic[1]),
        positive: true,
      };
      const first = await decode(id, { points: [realisticPoint] });
      const realisticMask = threshold(first.logits);

      const [x0, y0, x1, y1] = nucleus.box;
      const low = slideToModel(frame, { x: x0, y: y0 });
      const high = slideToModel(frame, { x: x1, y: y1 });
      const boxMask = threshold(
        (await decode(id, { points: [], box: { x0: low.x, y0: low.y, x1: high.x, y1: high.y } }))
          .logits,
      );

      const points = [realisticPoint];
      let current = first;
      let mask = realisticMask;
      const steps = [iou(mask, truth)];
      for (let step = 0; step < correctiveClicks; step++) {
        const error = new Uint8Array(side * side);
        for (let i = 0; i < error.length; i++) error[i] = mask[i] === truth[i] ? 0 : 1;
        const spot = deepest(error);
        const positive = truth[spot.y * side + spot.x] === 1;
        points.push({ x: spot.x + 0.5, y: spot.y + 0.5, positive });
        current = await decode(id, { points, previousLogits: current.lowRes });
        mask = threshold(current.logits);
        steps.push(iou(mask, truth));
      }

      scores.push({
        patch: patch.name,
        id: nucleus.id,
        area: nucleus.area,
        iou: {
          ideal: iou(idealMask, truth),
          realistic: iou(realisticMask, truth),
          box: iou(boxMask, truth),
          three: steps[steps.length - 1] ?? 0,
        },
        threeSteps: steps,
      });
    }
    engine.drop(id);
  }
  await engine.close();
  return {
    provider: request.provider,
    userAgent: navigator.userAgent,
    crossOriginIsolated: self.crossOriginIsolated,
    adapter,
    encoderGraph: request.provider === "webgpu" ? "encoder_q4" : "encoder_uint8",
    seed: manifest.seed,
    patches: manifest.patches.length,
    nuclei: scores.length,
    encodeMs,
    decodeMs,
    scores,
  };
}

window.smartSmoke = { run };
