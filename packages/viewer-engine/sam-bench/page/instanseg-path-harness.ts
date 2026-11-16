import * as ort from "onnxruntime-web";
import {
  type InstanSegInput,
  type InstanSegPostProcess,
  instansegInput,
  instansegLabels,
  networkInput,
  parsePostProcess,
  stretchChannels,
} from "../../src/instanseg/index.ts";
import { wasmMjsUrl, wasmUrl } from "./ort-wasm-urls.js";

export interface PathSetup {
  graphUrl: string;
  postUrl: string;
  threads: number;
}

export interface ParityRequest {
  inputUrl: string;
  outputUrl: string;
}

export interface ParityReport {
  pixels: number;
  agreeing: number;
  expectedInstances: number;
  gotInstances: number;
  seeds: number;
}

export interface TimingRequest {
  inputUrl: string;
  runs: number;
}

export interface TimingRun {
  prepareMs: number;
  networkMs: number;
  labelMs: number;
  totalMs: number;
  seeds: number;
}

export interface TimingReport {
  threads: number;
  hardwareConcurrency: number;
  crossOriginIsolated: boolean;
  createMs: number;
  tileSide: number;
  runs: TimingRun[];
}

export interface TileRequest {
  url: string;
  width: number;
  height: number;
  micronsPerPixel: number;
}

export interface TileReport {
  labels: number[];
  height: number;
  width: number;
  seeds: number;
  totalMs: number;
}

interface PathApi {
  setUp(setup: PathSetup): Promise<{ createMs: number; threads: number }>;
  parity(request: ParityRequest): Promise<ParityReport>;
  time(request: TimingRequest): Promise<TimingReport>;
  segment(request: TileRequest): Promise<TileReport>;
}

declare global {
  interface Window {
    instansegPath: PathApi;
  }
}

ort.env.wasm.wasmPaths = { mjs: wasmMjsUrl, wasm: wasmUrl };

const appThreads = 0;
const tileMicronsPerPixel = 0.25;

interface Loaded {
  session: ort.InferenceSession;
  post: InstanSegPostProcess;
  threads: number;
  createMs: number;
}

let loaded: Loaded | undefined;

function ready(): Loaded {
  if (!loaded) throw new Error("call instansegPath.setUp first");
  return loaded;
}

async function npy(url: string): Promise<{ data: Float32Array; shape: number[] }> {
  const bytes = await (await fetch(url)).arrayBuffer();
  const view = new DataView(bytes);
  const headerLength = view.getUint16(8, true);
  const header = new TextDecoder().decode(new Uint8Array(bytes, 10, headerLength));
  const shape = (/'shape': \(([^)]*)\)/.exec(header)?.[1] ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map(Number);
  return { data: new Float32Array(bytes.slice(10 + headerLength)), shape };
}

async function maps(input: InstanSegInput): Promise<Float32Array> {
  const { session } = ready();
  const tensor = new ort.Tensor("float32", input.pixels, [
    1,
    3,
    input.paddedHeight,
    input.paddedWidth,
  ]);
  const output = await session.run({ pixels: tensor });
  const result = output["maps"];
  if (!result) throw new Error("the InstanSeg graph returned no maps");
  const data = new Float32Array(result.data as Float32Array);
  result.dispose();
  return data;
}

async function labelsOf(input: InstanSegInput) {
  const data = await maps(input);
  return instansegLabels(
    { data, height: input.paddedHeight, width: input.paddedWidth },
    input.height,
    input.width,
    ready().post,
  );
}

function tileFromPlanes(planes: Float32Array, side: number): Uint8Array {
  const big = side * 2;
  const tile = new Uint8Array(big * big * 3);
  for (let row = 0; row < big; row += 1) {
    for (let column = 0; column < big; column += 1) {
      const source = Math.floor(row / 2) * side + Math.floor(column / 2);
      for (let channel = 0; channel < 3; channel += 1) {
        const value = planes[channel * side * side + source] ?? 0;
        tile[(row * big + column) * 3 + channel] = Math.round(
          Math.min(255, Math.max(0, value * 255)),
        );
      }
    }
  }
  return tile;
}

function agreement(got: Int32Array, expected: Float32Array): number {
  const votes = new Map<number, Map<number, number>>();
  for (let index = 0; index < got.length; index += 1) {
    const label = got[index] ?? 0;
    const truth = expected[index] ?? 0;
    const row = votes.get(label) ?? new Map<number, number>();
    row.set(truth, (row.get(truth) ?? 0) + 1);
    votes.set(label, row);
  }
  let agreeing = 0;
  for (const [label, row] of votes) {
    if (label === 0) {
      agreeing += row.get(0) ?? 0;
      continue;
    }
    agreeing += Math.max(...row.values());
  }
  return agreeing;
}

window.instansegPath = {
  async setUp(setup) {
    const threads = setup.threads === appThreads ? navigator.hardwareConcurrency : setup.threads;
    ort.env.wasm.numThreads = threads;
    const graph = new Uint8Array(await (await fetch(setup.graphUrl)).arrayBuffer());
    const post = parsePostProcess(await (await fetch(setup.postUrl)).json());
    const started = performance.now();
    const session = await ort.InferenceSession.create(graph, { executionProviders: ["wasm"] });
    const createMs = performance.now() - started;
    loaded = { session, post, threads, createMs };
    return { createMs, threads };
  },

  async parity(request) {
    const raw = await npy(request.inputUrl);
    const expected = await npy(request.outputUrl);
    const height = raw.shape[2] ?? 0;
    const width = raw.shape[3] ?? 0;
    const planes = new Float32Array(raw.data);
    stretchChannels(planes, height, width);
    const result = await labelsOf(networkInput(planes, height, width));
    const instances = (values: ArrayLike<number>) =>
      new Set(Array.from(values).filter((value) => value > 0)).size;
    return {
      pixels: result.labels.length,
      agreeing: agreement(result.labels, expected.data),
      expectedInstances: instances(expected.data),
      gotInstances: instances(result.labels),
      seeds: result.seeds,
    };
  },

  async time(request) {
    const raw = await npy(request.inputUrl);
    const side = raw.shape[3] ?? 0;
    const planes = new Float32Array(raw.data);
    stretchChannels(planes, side, side);
    const tile = {
      data: tileFromPlanes(planes, side),
      width: side * 2,
      height: side * 2,
      channels: 3,
    };
    const runs: TimingRun[] = [];
    for (let run = 0; run < request.runs; run += 1) {
      const started = performance.now();
      const input = instansegInput(tile, tileMicronsPerPixel);
      const prepared = performance.now();
      const data = await maps(input);
      const networked = performance.now();
      const result = instansegLabels(
        { data, height: input.paddedHeight, width: input.paddedWidth },
        input.height,
        input.width,
        ready().post,
      );
      const finished = performance.now();
      runs.push({
        prepareMs: prepared - started,
        networkMs: networked - prepared,
        labelMs: finished - networked,
        totalMs: finished - started,
        seeds: result.seeds,
      });
    }
    return {
      threads: ready().threads,
      hardwareConcurrency: navigator.hardwareConcurrency,
      crossOriginIsolated: self.crossOriginIsolated,
      createMs: ready().createMs,
      tileSide: tile.width,
      runs,
    };
  },

  async segment(request) {
    const data = new Uint8Array(await (await fetch(request.url)).arrayBuffer());
    const started = performance.now();
    const result = await labelsOf(
      instansegInput(
        { data, width: request.width, height: request.height, channels: 3 },
        request.micronsPerPixel,
      ),
    );
    return {
      labels: Array.from(result.labels),
      height: result.height,
      width: result.width,
      seeds: result.seeds,
      totalMs: performance.now() - started,
    };
  },
};
