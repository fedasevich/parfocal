import type { GpuWaiting, ViewToEmbed } from "@parfocal/api-client";
import type { SamClient, SamEncoded } from "@parfocal/viewer-engine";
import { type GpuCancel, serverGpuCancel, untilGpuAnswers } from "../gpu/gpu-wait.ts";
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
export const viewTimeoutMs = 6000;
export const viewRetryAfterMs = 20_000;

export type EncoderSource = "server" | "browser";

export type ViewEmbeddingPost = (slideId: string, view: ViewToEmbed) => Promise<ArrayBuffer>;

export interface ViewEmbeddings {
  embedding(slideId: string, view: ViewToEmbed): Promise<Float32Array<ArrayBuffer> | null>;
}

export interface ViewEmbeddingsOptions {
  readonly post?: ViewEmbeddingPost;
  readonly timeoutMs?: number;
  readonly retryAfterMs?: number;
  readonly now?: () => number;
  readonly wait?: (ms: number) => Promise<void>;
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

export function postViewEmbedding(
  fetcher: typeof fetch = (input, init) => fetch(input, init),
  cancelCall: GpuCancel = serverGpuCancel,
): ViewEmbeddingPost {
  return (slideId, view) =>
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
        if (!response.ok) throw new Error("The server did not embed the view");
        if (response.headers.get("Parfocal-Encoder") !== viewEncoder) {
          throw new Error("The server embedded the view with another encoder");
        }
        return { answered: await response.arrayBuffer() };
      },
      cancelCall,
    );
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createViewEmbeddings(options: ViewEmbeddingsOptions = {}): ViewEmbeddings {
  const post = options.post ?? postViewEmbedding();
  const timeoutMs = options.timeoutMs ?? viewTimeoutMs;
  const retryAfterMs = options.retryAfterMs ?? viewRetryAfterMs;
  const now = options.now ?? (() => Date.now());
  const wait = options.wait ?? sleep;
  let pausedUntil = 0;

  return {
    async embedding(slideId, view) {
      if (now() < pausedUntil) return null;
      const answered = post(slideId, view).then(
        (body) => {
          if (body.byteLength !== serverEmbeddingValues * 2) return null;
          pausedUntil = 0;
          return decodeFloat16(body);
        },
        () => null,
      );
      const first = await Promise.race([answered, wait(timeoutMs).then(() => "late" as const)]);
      if (first === "late" || first === null) {
        pausedUntil = now() + retryAfterMs;
        return null;
      }
      return first;
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
    try {
      const embedding = view === null ? null : await context.views.embedding(parsed.slideId, view);
      const adopted = embedding === null ? null : await sam.adopt(id, embedding, "vit-l");
      context.onSource?.(adopted === null ? "browser" : "server");
      return adopted;
    } catch {
      context.onSource?.("browser");
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
