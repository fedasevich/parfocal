import type { EngineSlide, SlideOpener, SlideRef } from "../engine/types.ts";
import {
  createDefaultPixelSourceRegistry,
  type PixelSourceRegistry,
} from "../pixel-source/registry.ts";
import type { OpenRequest, PixelSource } from "../pixel-source/types.ts";

export interface PixelSlide extends EngineSlide {
  readonly source: PixelSource;
}

export type OpenRequestResolver = (ref: SlideRef) => OpenRequest | Promise<OpenRequest>;

export function pixelSlide(id: string, source: PixelSource): PixelSlide {
  const [base] = source.levels;
  if (base === undefined) throw new Error(`Slide ${id} has no levels`);
  return {
    id,
    width: base.width,
    height: base.height,
    micronsPerPixel: source.micronsPerPixel?.x ?? null,
    source,
    close: () => source.close(),
  };
}

export function createPixelSlideOpener(
  resolve: OpenRequestResolver,
  registry: PixelSourceRegistry = createDefaultPixelSourceRegistry(),
): SlideOpener<PixelSlide> {
  return async (ref, signal) => {
    const request = await resolve(ref);
    const source = await registry.open({ ...request, signal });
    if (signal.aborted) {
      source.close();
      signal.throwIfAborted();
    }
    return pixelSlide(ref.id, source);
  };
}
