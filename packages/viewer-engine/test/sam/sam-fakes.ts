import type {
  ModelCache,
  SamProvider,
  SamRuntime,
  SamSession,
  SamTensor,
} from "../../src/index.ts";

export interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: Error): void;
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

export function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

export class FakeTensor implements SamTensor {
  disposed = false;

  readonly dims: readonly number[];
  readonly data: Float32Array;

  constructor(dims: readonly number[], data: Float32Array) {
    this.dims = dims;
    this.data = data;
  }

  dispose(): void {
    this.disposed = true;
  }
}

export interface FakeSessionOptions {
  readonly graph: string;
  readonly inputNames: readonly string[];
  readonly outputNames: readonly string[];
}

export class FakeSession implements SamSession {
  readonly feedsSeen: Readonly<Record<string, SamTensor>>[] = [];
  released = false;
  hold = false;
  readonly gates: Deferred<void>[] = [];
  failWith: Error | null = null;

  readonly options: FakeSessionOptions;

  constructor(options: FakeSessionOptions) {
    this.options = options;
  }

  get inputNames(): readonly string[] {
    return this.options.inputNames;
  }

  get outputNames(): readonly string[] {
    return this.options.outputNames;
  }

  async run(feeds: Readonly<Record<string, SamTensor>>): Promise<Record<string, SamTensor>> {
    this.feedsSeen.push(feeds);
    if (this.failWith !== null) {
      throw this.failWith;
    }
    if (this.hold) {
      const gate = deferred<void>();
      this.gates.push(gate);
      await gate.promise;
    }
    const outputs: Record<string, SamTensor> = {};
    for (const name of this.options.outputNames) {
      outputs[name] = new FakeTensor([1, 1], Float32Array.of(this.feedsSeen.length));
    }
    return outputs;
  }

  release(): Promise<void> {
    this.released = true;
    return Promise.resolve();
  }
}

export interface FakeRuntimeOptions {
  readonly decoderInputs?: readonly string[];
  readonly createDelayMs?: number;
  readonly failProviders?: readonly SamProvider[];
}

export const defaultDecoderInputs = [
  "image_embeddings",
  "point_coords",
  "point_labels",
  "mask_input",
  "has_mask_input",
  "orig_im_size",
] as const;

export class FakeRuntime implements SamRuntime {
  readonly created: { graph: string; provider: SamProvider; session: FakeSession }[] = [];
  readonly tensors: FakeTensor[] = [];
  inFlight = 0;
  maxInFlight = 0;

  private readonly options: FakeRuntimeOptions;

  constructor(options: FakeRuntimeOptions = {}) {
    this.options = options;
  }

  async createSession(bytes: Uint8Array, provider: SamProvider): Promise<SamSession> {
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    try {
      await new Promise((resolve) => setTimeout(resolve, this.options.createDelayMs ?? 5));
      if (this.options.failProviders?.includes(provider)) {
        throw new Error(`no ${provider}`);
      }
      const graph = new TextDecoder().decode(bytes);
      const isDecoder = graph === "pathosam.decoder.onnx";
      const isAis = graph.includes("ais_decoder");
      const session = new FakeSession({
        graph,
        inputNames: isDecoder
          ? (this.options.decoderInputs ?? defaultDecoderInputs)
          : isAis
            ? ["image_embeddings"]
            : ["pixel_values"],
        outputNames: isDecoder
          ? ["masks", "iou_predictions", "low_res_masks"]
          : isAis
            ? ["maps"]
            : ["image_embeddings"],
      });
      this.created.push({ graph, provider, session });
      return session;
    } finally {
      this.inFlight -= 1;
    }
  }

  tensor(data: Float32Array, dims: readonly number[]): SamTensor {
    const tensor = new FakeTensor(dims, data);
    this.tensors.push(tensor);
    return tensor;
  }

  session(graph: string): FakeSession {
    const found = this.created.find((entry) => entry.graph === graph);
    if (found === undefined) {
      throw new Error(`no session for ${graph}`);
    }
    return found.session;
  }
}

export class FakeModelCache implements ModelCache {
  readonly urls: string[] = [];

  load(url: string) {
    this.urls.push(url);
    const graph = url.slice(url.lastIndexOf("/") + 1);
    return Promise.resolve({
      bytes: new TextEncoder().encode(graph),
      source: "cache" as const,
      downloadedBytes: 0,
      message: "Loaded from cache",
      replacedCorruptEntry: false,
      revalidation: null,
    });
  }
}
