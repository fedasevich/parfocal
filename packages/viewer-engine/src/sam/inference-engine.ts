import type { ModelCache } from "./model-cache.ts";
import type { SamRuntime, SamSession, SamTensor } from "./runtime.ts";
import { type SamGraph, type SamProvider, samProvider, samVariant } from "./variants.ts";

export const samImageSize = 1024;
export const samMaskInputSize = 256;
export const samEmbeddingDims: readonly number[] = [1, 256, 64, 64];
export const defaultEmbeddingCapacity = 6;

export interface SamPoint {
  readonly x: number;
  readonly y: number;
  readonly positive: boolean;
}

export interface SamBox {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

export interface SamPrompt {
  readonly points: readonly SamPoint[];
  readonly box?: SamBox | null;
  readonly previousLogits?: Float32Array | null;
}

export interface SamOutput {
  readonly dims: readonly number[];
  readonly data: Float32Array;
}

export type SamOutputs = Readonly<Record<string, SamOutput>>;

export type SamPromptOutcome =
  | { readonly status: "answer"; readonly outputs: SamOutputs; readonly ms: number }
  | { readonly status: "stale" };

export interface SamGraphLoad {
  readonly graph: SamGraph;
  readonly message: string;
}

export interface SamReady {
  readonly provider: SamProvider;
  readonly fellBack: boolean;
  readonly loads: readonly SamGraphLoad[];
  readonly warmed: boolean;
}

export interface SamEncoded {
  readonly id: string;
  readonly ms: number;
  readonly evicted: readonly string[];
}

export interface InferenceEngineOptions {
  readonly runtime: SamRuntime;
  readonly cache: ModelCache;
  readonly modelsUrl: string;
  readonly hasGpuAdapter: () => Promise<boolean>;
  readonly embeddingCapacity?: number;
  readonly warm?: boolean;
  readonly onStage?: (graph: SamGraph) => void;
}

export interface InferenceEngine {
  init(): Promise<SamReady>;
  encode(id: string, pixels: Float32Array): Promise<SamEncoded>;
  prompt(id: string, prompt: SamPrompt): Promise<SamPromptOutcome>;
  segmentAll(id: string): Promise<SamOutputs>;
  drop(id: string): void;
  hasEmbedding(id: string): boolean;
  close(): Promise<void>;
}

export class UnsupportedGraphInputError extends Error {
  readonly input: string;

  constructor(input: string) {
    super(`The decoder graph asks for an input this client does not fill: ${input}`);
    this.name = "UnsupportedGraphInputError";
    this.input = input;
  }
}

export class UnknownEmbeddingError extends Error {
  constructor(id: string) {
    super(`No embedding is held for ${id}`);
    this.name = "UnknownEmbeddingError";
  }
}

export class EngineNotReadyError extends Error {
  constructor() {
    super("The inference engine has not been started");
    this.name = "EngineNotReadyError";
  }
}

const padLabel = -1;
const boxStartLabel = 2;
const boxEndLabel = 3;
const embeddingValues = samEmbeddingDims.reduce((product, size) => product * size, 1);

function embeddingOutput(session: SamSession): string {
  return (
    session.outputNames.find((name) => name === "image_embeddings") ?? session.outputNames[0] ?? ""
  );
}

function toOutputs(raw: Record<string, SamTensor>): SamOutputs {
  const outputs: Record<string, SamOutput> = {};
  for (const [name, tensor] of Object.entries(raw)) {
    outputs[name] = { dims: [...tensor.dims], data: tensor.data.slice() };
    tensor.dispose();
  }
  return outputs;
}

function promptFeed(
  runtime: SamRuntime,
  name: string,
  embedding: SamTensor,
  prompt: SamPrompt,
): SamTensor {
  const { points } = prompt;
  const box = prompt.box ?? null;
  const count = points.length + (box === null ? 1 : 2);
  if (name === "image_embeddings") {
    return embedding;
  }
  if (name === "point_coords") {
    const coords = new Float32Array(count * 2);
    points.forEach((point, index) => {
      coords[index * 2] = point.x;
      coords[index * 2 + 1] = point.y;
    });
    if (box !== null) {
      coords.set([box.x0, box.y0, box.x1, box.y1], points.length * 2);
    }
    return runtime.tensor(coords, [1, count, 2]);
  }
  if (name === "point_labels") {
    const labels = new Float32Array(count);
    points.forEach((point, index) => {
      labels[index] = point.positive ? 1 : 0;
    });
    if (box === null) {
      labels[points.length] = padLabel;
    } else {
      labels[points.length] = boxStartLabel;
      labels[points.length + 1] = boxEndLabel;
    }
    return runtime.tensor(labels, [1, count]);
  }
  if (name === "mask_input") {
    const logits = prompt.previousLogits ?? new Float32Array(samMaskInputSize ** 2);
    return runtime.tensor(logits, [1, 1, samMaskInputSize, samMaskInputSize]);
  }
  if (name === "has_mask_input") {
    return runtime.tensor(Float32Array.of(prompt.previousLogits ? 1 : 0), [1]);
  }
  if (name === "orig_im_size") {
    return runtime.tensor(Float32Array.of(samImageSize, samImageSize), [2]);
  }
  throw new UnsupportedGraphInputError(name);
}

export function createInferenceEngine(options: InferenceEngineOptions): InferenceEngine {
  const { runtime, cache } = options;
  const capacity = options.embeddingCapacity ?? defaultEmbeddingCapacity;
  const modelsBase = options.modelsUrl.endsWith("/") ? options.modelsUrl : `${options.modelsUrl}/`;
  const embeddings = new Map<string, SamTensor>();

  let sessionLock: Promise<unknown> = Promise.resolve();
  let runLock: Promise<unknown> = Promise.resolve();
  let starting: Promise<SamReady> | null = null;
  let provider: SamProvider = "wasm";
  let encoder: SamSession | null = null;
  let decoder: SamSession | null = null;
  let aisDecoder: Promise<SamSession> | null = null;
  let promptSequence = 0;
  let closed = false;

  function inSession<T>(job: () => Promise<T>): Promise<T> {
    const next = sessionLock.then(job, job);
    sessionLock = next.catch(() => undefined);
    return next;
  }

  function inRun<T>(job: () => Promise<T>): Promise<T> {
    const next = runLock.then(job, job);
    runLock = next.catch(() => undefined);
    return next;
  }

  function createSession(
    graph: SamGraph,
    onProvider: SamProvider,
    loads: SamGraphLoad[],
  ): Promise<SamSession> {
    return inSession(async () => {
      options.onStage?.(graph);
      const load = await cache.load(`${modelsBase}${graph}`);
      loads.push({ graph, message: load.message });
      return runtime.createSession(load.bytes, onProvider);
    });
  }

  async function loadVariant(
    onProvider: SamProvider,
    loads: SamGraphLoad[],
  ): Promise<{ encoder: SamSession; decoder: SamSession }> {
    const variant = samVariant(onProvider);
    const decoderSession = await createSession(variant.decoder, onProvider, loads);
    try {
      const encoderSession = await createSession(variant.encoder, onProvider, loads);
      return { encoder: encoderSession, decoder: decoderSession };
    } catch (error) {
      await decoderSession.release();
      throw error;
    }
  }

  function buildFeeds(
    session: SamSession,
    embedding: SamTensor,
    prompt: SamPrompt,
  ): Record<string, SamTensor> {
    const feeds: Record<string, SamTensor> = {};
    try {
      for (const name of session.inputNames) {
        feeds[name] = promptFeed(runtime, name, embedding, prompt);
      }
    } catch (error) {
      disposeFeeds(feeds, embedding);
      throw error;
    }
    return feeds;
  }

  function disposeFeeds(feeds: Record<string, SamTensor>, keep: SamTensor): void {
    for (const tensor of Object.values(feeds)) {
      if (tensor !== keep) {
        tensor.dispose();
      }
    }
  }

  async function runDecoder(
    session: SamSession,
    embedding: SamTensor,
    prompt: SamPrompt,
  ): Promise<SamOutputs> {
    const feeds = buildFeeds(session, embedding, prompt);
    try {
      return toOutputs(await session.run(feeds));
    } finally {
      disposeFeeds(feeds, embedding);
    }
  }

  async function warmDecoder(session: SamSession): Promise<boolean> {
    const zeros = runtime.tensor(new Float32Array(embeddingValues), samEmbeddingDims);
    try {
      const middle = samImageSize / 2;
      await runDecoder(session, zeros, { points: [{ x: middle, y: middle, positive: true }] });
      return true;
    } catch {
      return false;
    } finally {
      zeros.dispose();
    }
  }

  async function startUp(): Promise<SamReady> {
    const loads: SamGraphLoad[] = [];
    let chosen = samProvider(await options.hasGpuAdapter());
    let fellBack = false;
    let sessions: { encoder: SamSession; decoder: SamSession };
    try {
      sessions = await loadVariant(chosen, loads);
    } catch (error) {
      if (chosen !== "webgpu") {
        throw error;
      }
      chosen = "wasm";
      fellBack = true;
      loads.length = 0;
      sessions = await loadVariant(chosen, loads);
    }
    provider = chosen;
    encoder = sessions.encoder;
    decoder = sessions.decoder;
    const warmed = options.warm === false ? false : await warmDecoder(sessions.decoder);
    return { provider: chosen, fellBack, loads, warmed };
  }

  async function ready(): Promise<{ encoder: SamSession; decoder: SamSession }> {
    if (starting === null || closed) {
      throw new EngineNotReadyError();
    }
    await starting;
    if (encoder === null || decoder === null || closed) {
      throw new EngineNotReadyError();
    }
    return { encoder, decoder };
  }

  function embeddingFor(id: string): SamTensor {
    const tensor = embeddings.get(id);
    if (tensor === undefined) {
      throw new UnknownEmbeddingError(id);
    }
    embeddings.delete(id);
    embeddings.set(id, tensor);
    return tensor;
  }

  function keepEmbedding(id: string, embedding: SamTensor): string[] {
    embeddings.get(id)?.dispose();
    embeddings.delete(id);
    embeddings.set(id, embedding);
    const evicted: string[] = [];
    for (const oldest of embeddings.keys()) {
      if (embeddings.size <= capacity) {
        break;
      }
      embeddings.get(oldest)?.dispose();
      embeddings.delete(oldest);
      evicted.push(oldest);
    }
    return evicted;
  }

  return {
    init() {
      starting ??= startUp().catch((error: unknown) => {
        starting = null;
        throw error;
      });
      return starting;
    },

    encode(id, pixels) {
      return inRun(async () => {
        const { encoder: session } = await ready();
        if (pixels.length !== 3 * samImageSize * samImageSize) {
          throw new RangeError(
            `The encoder input must hold 3 x ${samImageSize} x ${samImageSize} values`,
          );
        }
        const started = performance.now();
        const input = runtime.tensor(pixels, [1, 3, samImageSize, samImageSize]);
        let outputs: Record<string, SamTensor>;
        try {
          outputs = await session.run({ [session.inputNames[0] ?? "pixel_values"]: input });
        } finally {
          input.dispose();
        }
        const name = embeddingOutput(session);
        const embedding = outputs[name];
        for (const [other, tensor] of Object.entries(outputs)) {
          if (other !== name) {
            tensor.dispose();
          }
        }
        if (embedding === undefined) {
          throw new Error("The encoder gave no image embedding");
        }
        const evicted = keepEmbedding(id, embedding);
        return { id, ms: performance.now() - started, evicted };
      });
    },

    prompt(id, prompt) {
      promptSequence += 1;
      const sequence = promptSequence;
      return inRun(async (): Promise<SamPromptOutcome> => {
        if (sequence !== promptSequence) {
          return { status: "stale" };
        }
        const { decoder: session } = await ready();
        const started = performance.now();
        const outputs = await runDecoder(session, embeddingFor(id), prompt);
        if (sequence !== promptSequence) {
          return { status: "stale" };
        }
        return { status: "answer", outputs, ms: performance.now() - started };
      });
    },

    segmentAll(id) {
      return inRun(async () => {
        await ready();
        const embedding = embeddingFor(id);
        aisDecoder ??= createSession(samVariant(provider).aisDecoder, provider, []);
        let session: SamSession;
        try {
          session = await aisDecoder;
        } catch (error) {
          aisDecoder = null;
          throw error;
        }
        return toOutputs(await session.run({ image_embeddings: embedding }));
      });
    },

    drop(id) {
      embeddings.get(id)?.dispose();
      embeddings.delete(id);
    },

    hasEmbedding(id) {
      return embeddings.has(id);
    },

    async close() {
      closed = true;
      promptSequence += 1;
      await runLock;
      for (const tensor of embeddings.values()) {
        tensor.dispose();
      }
      embeddings.clear();
      const ais = aisDecoder === null ? null : await aisDecoder.catch(() => null);
      await Promise.all([encoder?.release(), decoder?.release(), ais?.release()]);
      encoder = null;
      decoder = null;
      aisDecoder = null;
    },
  };
}
