import { assertWebGpuAvailable, type GpuLike } from "../deck-webgpu/availability.ts";
import type { RendererFactory } from "../engine/types.ts";
import type { PixelSlide } from "../viv/pixel-slide.ts";
import {
  type CustomWebGpuRouteOptions,
  customWebGpuRendererFactory,
} from "./custom-webgpu-route.ts";

export {
  type CustomWebGpuRoute,
  type CustomWebGpuRouteOptions,
  CustomWebGpuUnsupportedOverlayError,
  createCustomWebGpuRoute,
  customWebGpuRendererFactory,
  customWebGpuTileRequests,
  type RenderWorkerLike,
  spawnRenderWorker,
  UnsupportedCustomWebGpuSourceError,
} from "./custom-webgpu-route.ts";
export {
  createOverlayBuffers,
  instanceCapacity,
  type OverlayBuffers,
  type OverlaySet,
} from "./overlay-buffers.ts";
export {
  atlasLayersFor,
  magnifiesFinestLevel,
  parentTile,
  type TileAddress,
  tileInstances,
  tileLevelFor,
  visibleTiles,
} from "./tile-selection.ts";
export {
  buildVectorInstances,
  segmentInstanceBytes,
  triangleInstanceBytes,
  type VectorInstances,
} from "./vector-instances.ts";

export async function loadCustomWebGpuRoute(
  options: CustomWebGpuRouteOptions = {},
): Promise<RendererFactory<PixelSlide>> {
  await assertWebGpuAvailable((globalThis.navigator as { gpu?: GpuLike } | undefined)?.gpu);
  return customWebGpuRendererFactory(options);
}
