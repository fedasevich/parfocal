import type { RendererFactory } from "../engine/types.ts";
import type { PixelSlide } from "../viv/pixel-slide.ts";
import { assertWebGpuAvailable, type GpuLike } from "./availability.ts";
import { type DeckWebGpuRouteOptions, deckWebGpuRendererFactory } from "./deck-webgpu-route.ts";

export { assertWebGpuAvailable, type GpuLike, WebGpuUnavailableError } from "./availability.ts";
export {
  type BufferLimitSplit,
  polygonBufferBytes,
  polygonVertexBytes,
  splitByBufferLimit,
  WebGpuBufferLimitError,
} from "./buffer-limit.ts";
export {
  createDeckWebGpuRoute,
  type DeckWebGpuRoute,
  type DeckWebGpuRouteOptions,
  deckWebGpuRendererFactory,
  deckWebGpuViewId,
  UnsupportedDeckWebGpuSourceError,
} from "./deck-webgpu-route.ts";
export { rgbToRgba } from "./rgba.ts";

export async function loadDeckWebGpuRoute(
  options: DeckWebGpuRouteOptions = {},
): Promise<RendererFactory<PixelSlide>> {
  await assertWebGpuAvailable((globalThis.navigator as { gpu?: GpuLike } | undefined)?.gpu);
  return deckWebGpuRendererFactory(options);
}
