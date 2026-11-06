import * as ort from "onnxruntime-web/webgpu";
import { wasmMjsUrl, wasmUrl } from "./ort-wasm-urls.js";
import type { SamRuntime, SamSession, SamTensor } from "./runtime.ts";
import type { SamProvider } from "./variants.ts";

function wrapTensor(tensor: ort.Tensor): SamTensor {
  return {
    dims: tensor.dims,
    data: tensor.data as Float32Array,
    dispose: () => tensor.dispose(),
  };
}

function unwrapTensor(tensor: SamTensor): ort.Tensor {
  return new ort.Tensor("float32", tensor.data, [...tensor.dims]);
}

function wrapSession(session: ort.InferenceSession): SamSession {
  return {
    inputNames: session.inputNames,
    outputNames: session.outputNames,
    async run(feeds) {
      const outputs = await session.run(
        Object.fromEntries(
          Object.entries(feeds).map(([name, tensor]) => [name, unwrapTensor(tensor)]),
        ),
      );
      return Object.fromEntries(
        Object.entries(outputs).map(([name, tensor]) => [name, wrapTensor(tensor)]),
      );
    },
    release: () => session.release(),
  };
}

export function createOrtRuntime(hardwareConcurrency: number): SamRuntime {
  ort.env.wasm.wasmPaths = { mjs: wasmMjsUrl, wasm: wasmUrl };
  ort.env.wasm.numThreads = hardwareConcurrency;
  return {
    async createSession(bytes: Uint8Array, provider: SamProvider) {
      const session = await ort.InferenceSession.create(bytes, {
        executionProviders: [provider],
      });
      return wrapSession(session);
    },
    tensor: (data, dims) => wrapTensor(new ort.Tensor("float32", data, [...dims])),
  };
}
