import type { ScalePresetId } from "../../aiseg/scale-presets.ts";
import { createEmbeddingFeatures, type EmbeddingServices } from "./embedding-features.ts";
import type { PooledFeaturesOf } from "./slide-learner.ts";

export type LoadedEmbeddingServices = {
  services: EmbeddingServices;
  close: () => void;
};

export type LazyEmbeddingOptions = {
  load: () => Promise<LoadedEmbeddingServices>;
  preset: ScalePresetId;
  ringOf: (object: string) => Float32Array | undefined;
  slideKey?: string;
};

export type LazyEmbeddingFeatures = {
  features: PooledFeaturesOf;
  close: () => void;
};

export function createLazyEmbeddingFeatures(options: LazyEmbeddingOptions): LazyEmbeddingFeatures {
  let loading: Promise<{ source: PooledFeaturesOf; close: () => void }> | null = null;
  let closed = false;

  const start = () => {
    loading ??= options.load().then((loaded) => ({
      close: loaded.close,
      source: createEmbeddingFeatures({
        services: loaded.services,
        preset: options.preset,
        ringOf: options.ringOf,
        ...(options.slideKey === undefined ? {} : { slideKey: options.slideKey }),
      }),
    }));
    return loading;
  };

  return {
    features: async (cells) => {
      if (closed) return new Map();
      const { source } = await start();
      return closed ? new Map() : source(cells);
    },
    close: () => {
      closed = true;
      const pending = loading;
      loading = null;
      void pending?.then((loaded) => loaded.close()).catch(() => undefined);
    },
  };
}
