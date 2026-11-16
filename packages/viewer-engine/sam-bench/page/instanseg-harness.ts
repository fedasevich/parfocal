import * as ort from "onnxruntime-web";
import { wasmMjsUrl, wasmUrl } from "./ort-wasm-urls.js";

export interface InstanSegBenchRequest {
  graphUrl: string;
  sides: readonly number[];
  threads: number;
  runs: number;
}

export interface InstanSegBenchTiming {
  side: number;
  threads: number;
  createMs: number;
  runsMs: number[];
  outputShape: readonly number[];
}

export interface InstanSegBenchReport {
  hardwareConcurrency: number;
  crossOriginIsolated: boolean;
  timings: InstanSegBenchTiming[];
}

declare global {
  interface Window {
    instansegBench: { run: (request: InstanSegBenchRequest) => Promise<InstanSegBenchReport> };
  }
}

ort.env.wasm.wasmPaths = { mjs: wasmMjsUrl, wasm: wasmUrl };

const appThreads = 0;

function seededPixels(side: number): Float32Array {
  const values = new Float32Array(3 * side * side);
  let state = 12345;
  for (let index = 0; index < values.length; index += 1) {
    state = (state * 1103515245 + 12345) % 2147483648;
    values[index] = state / 2147483648;
  }
  return values;
}

async function timeGraph(
  bytes: Uint8Array,
  side: number,
  threads: number,
  runs: number,
): Promise<InstanSegBenchTiming> {
  const started = performance.now();
  const session = await ort.InferenceSession.create(bytes, { executionProviders: ["wasm"] });
  const createMs = performance.now() - started;
  const input = new ort.Tensor("float32", seededPixels(side), [1, 3, side, side]);
  const runsMs: number[] = [];
  let outputShape: readonly number[] = [];
  for (let run = 0; run < runs; run += 1) {
    const before = performance.now();
    const output = await session.run({ pixels: input });
    runsMs.push(performance.now() - before);
    const maps = output["maps"];
    if (maps) {
      outputShape = maps.dims;
      maps.dispose();
    }
  }
  await session.release();
  return { side, threads, createMs, runsMs, outputShape };
}

window.instansegBench = {
  async run(request) {
    const bytes = new Uint8Array(await (await fetch(request.graphUrl)).arrayBuffer());
    const threads =
      request.threads === appThreads ? navigator.hardwareConcurrency : request.threads;
    ort.env.wasm.numThreads = threads;
    const timings: InstanSegBenchTiming[] = [];
    for (const side of request.sides) {
      timings.push(await timeGraph(bytes, side, threads, request.runs));
    }
    return {
      hardwareConcurrency: navigator.hardwareConcurrency,
      crossOriginIsolated: self.crossOriginIsolated,
      timings,
    };
  },
};
