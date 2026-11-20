import type { GpuWaiting, ViewToEmbed } from "@parfocal/api-client";
import type { SamClient, SamEncoded } from "@parfocal/viewer-engine";
import {
  GpuCallCancelledError,
  type GpuCancel,
  serverGpuCancel,
  untilGpuAnswers,
} from "../gpu/gpu-wait.ts";
import type { PresetPatchReader } from "./patch-reader.ts";
import {
  decodeFloat16,
  parseEmbeddingId,
  serverEmbeddingValues,
  type TileWindow,
} from "./server-embeddings.ts";

export const viewEncoder = "pathosam-vit-l-histopathology-fp32";
export const minViewSide = 16;
export const maxViewSide = 4096;
export const viewShowWaitAfterMs = 8000;
export const viewGiveUpMs = 180_000;

export type BestFallback = "unsendable" | "refused" | "offline" | "gave-up" | "cancelled";

export type EncoderSource = "asking" | "server" | BestFallback;

export type ViewAnswer =
  | { readonly embedding: Float32Array<ArrayBuffer> }
  | { readonly fallback: BestFallback };

export type ViewEmbeddingPost = (
  slideId: string,
  view: ViewToEmbed,
  signal: AbortSignal,
) => Promise<ArrayBuffer>;

export interface ViewEmbeddings {
  embedding(slideId: string, view: ViewToEmbed): Promise<ViewAnswer>;
}

export interface ViewEmbeddingsOptions {
  readonly post?: ViewEmbeddingPost;
  readonly giveUpMs?: number;
}

export interface EncoderSourceSignal {
  get(): EncoderSource | null;
  set(source: EncoderSource): void;
  subscribe(listener: (source: EncoderSource) => void): () => void;
}

export interface SlideSize {
  readonly width: number;
  readonly height: number;
}

export type ViewSam = Pick<SamClient, "encode" | "adopt">;

export class BestRefusedError extends Error {
  readonly reason: "refused" | "offline";

  constructor(reason: "refused" | "offline") {
    super(reason === "refused" ? "The server refused Best" : "Best's GPU is not answering");
    this.name = "BestRefusedError";
    this.reason = reason;
  }
}

const reasonOfStatus = (status: number): "refused" | "offline" =>
  status >= 500 || status === 429 ? "offline" : "refused";

export function postViewEmbedding(
  fetcher: typeof fetch = (input, init) => fetch(input, init),
  cancelCall: GpuCancel = serverGpuCancel,
  showAfterMs: number = viewShowWaitAfterMs,
): ViewEmbeddingPost {
  return (slideId, view, outside) =>
    untilGpuAnswers(
      "encoder",
      async (call, signal) => {
        const query = call === null ? "" : `?${new URLSearchParams({ call }).toString()}`;
        const response = await fetcher(`/api/slides/${slideId}/embeddings/view${query}`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(view),
          signal,
        });
        if (response.status === 202) return { waiting: (await response.json()) as GpuWaiting };
        if (!response.ok) throw new BestRefusedError(reasonOfStatus(response.status));
        if (response.headers.get("Parfocal-Encoder") !== viewEncoder) {
          throw new BestRefusedError("refused");
        }
        return { answered: await response.arrayBuffer() };
      },
      cancelCall,
      { showAfterMs, signal: outside },
    );
}

export function createViewEmbeddings(options: ViewEmbeddingsOptions = {}): ViewEmbeddings {
  const post = options.post ?? postViewEmbedding();
  const giveUpMs = options.giveUpMs ?? viewGiveUpMs;

  return {
    async embedding(slideId, view) {
      const controller = new AbortController();
      let gaveUp = false;
      const timer = setTimeout(() => {
        gaveUp = true;
        controller.abort();
      }, giveUpMs);
      try {
        const body = await post(slideId, view, controller.signal);
        if (body.byteLength !== serverEmbeddingValues * 2) return { fallback: "refused" };
        return { embedding: decodeFloat16(body) };
      } catch (error) {
        if (gaveUp) return { fallback: "gave-up" };
        if (error instanceof GpuCallCancelledError) return { fallback: "cancelled" };
        if (error instanceof BestRefusedError) return { fallback: error.reason };
        return { fallback: "offline" };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export function viewOf(
  window: TileWindow,
  downsample: number,
  slide: SlideSize,
): ViewToEmbed | null {
  const x = Math.round(window.x * downsample);
  const y = Math.round(window.y * downsample);
  const width = Math.min(Math.round(window.width * downsample), slide.width - x);
  const height = Math.min(Math.round(window.height * downsample), slide.height - y);
  const fits = (side: number) => side >= minViewSide && side <= maxViewSide;
  if (x < 0 || y < 0 || !fits(width) || !fits(height)) return null;
  return { x, y, width, height };
}

export function createEncoderSource(): EncoderSourceSignal {
  const listeners = new Set<(source: EncoderSource) => void>();
  let current: EncoderSource | null = null;
  return {
    get: () => current,
    set(source) {
      current = source;
      for (const listener of listeners) listener(source);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export interface ViewEmbeddingContext {
  readonly views: ViewEmbeddings;
  readonly slideId: string;
  readonly slide: SlideSize;
  readonly downsampleOf: (level: number) => number | undefined;
  readonly onSource?: (source: EncoderSource) => void;
}

export function withViewEmbeddings<S extends ViewSam>(sam: S, context: ViewEmbeddingContext): S {
  async function fromServer(id: string): Promise<SamEncoded | null> {
    const parsed = parseEmbeddingId(id);
    if (parsed === null || parsed.slideId !== context.slideId) return null;
    const downsample = context.downsampleOf(parsed.window.level);
    const view = downsample === undefined ? null : viewOf(parsed.window, downsample, context.slide);
    if (view === null) {
      context.onSource?.("unsendable");
      return null;
    }
    try {
      context.onSource?.("asking");
      const answer = await context.views.embedding(parsed.slideId, view);
      if ("fallback" in answer) {
        context.onSource?.(answer.fallback);
        return null;
      }
      const adopted = await sam.adopt(id, answer.embedding, "vit-l");
      context.onSource?.("server");
      return adopted;
    } catch {
      context.onSource?.("unsendable");
      return null;
    }
  }

  return {
    ...sam,
    async encode(id: string, pixels: Float32Array<ArrayBuffer>): Promise<SamEncoded> {
      return (await fromServer(id)) ?? sam.encode(id, pixels);
    },
  };
}

export function withSeenLevels(
  reader: PresetPatchReader,
  seen: Map<number, number>,
): PresetPatchReader {
  return {
    ...reader,
    async read(query, signal) {
      const read = await reader.read(query, signal);
      seen.set(read.patch.level, read.patch.downsample);
      return read;
    },
  };
}
