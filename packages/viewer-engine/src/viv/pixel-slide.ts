import type { SlideArea } from "../camera/camera.ts";
import { cachedFetch } from "../decode/byte-relay.ts";
import { createRangeCache, type RangeCache } from "../decode/range-cache.ts";
import type { EngineSlide, SlideOpener, SlideRef } from "../engine/types.ts";
import {
  createDefaultPixelSourceRegistry,
  type PixelSourceRegistry,
} from "../pixel-source/registry.ts";
import type { OpenRequest, PixelSource } from "../pixel-source/types.ts";

export interface PixelSlide extends EngineSlide {
  readonly source: PixelSource;
  readonly opened: OpenRequest | null;
  readonly bytes: RangeCache | null;
}

export type PixelSlideRequest = OpenRequest & { readonly tissue?: SlideArea | null };

export type OpenRequestResolver = (ref: SlideRef) => PixelSlideRequest | Promise<PixelSlideRequest>;

export function pixelSlide(
  id: string,
  source: PixelSource,
  opened: OpenRequest | null = null,
  bytes: RangeCache | null = null,
  tissue: SlideArea | null = null,
): PixelSlide {
  const [base] = source.levels;
  if (base === undefined) throw new Error(`Slide ${id} has no levels`);
  return {
    id,
    width: base.width,
    height: base.height,
    micronsPerPixel: source.micronsPerPixel?.x ?? null,
    tissue,
    source,
    opened,
    bytes,
    close: () => {
      source.close();
      bytes?.clear();
    },
  };
}

export function createPixelSlideOpener(
  resolve: OpenRequestResolver,
  registry: PixelSourceRegistry = createDefaultPixelSourceRegistry(),
): SlideOpener<PixelSlide> {
  return async (ref, signal) => {
    const { tissue, ...request } = await resolve(ref);
    const bytes = createRangeCache(request.fetch === undefined ? {} : { fetch: request.fetch });
    const source = await registry.open({ ...request, fetch: cachedFetch(bytes), signal });
    if (signal.aborted) {
      source.close();
      signal.throwIfAborted();
    }
    return pixelSlide(ref.id, source, request, bytes, tissue ?? null);
  };
}
