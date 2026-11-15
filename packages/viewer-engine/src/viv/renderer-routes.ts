import type { CustomWebGpuRouteOptions } from "../custom-webgpu/custom-webgpu-route.ts";
import type { DeckWebGpuRouteOptions } from "../deck-webgpu/deck-webgpu-route.ts";
import type { RendererRouteLoaders } from "../engine/renderer-switch.ts";
import type { PixelSlide } from "./pixel-slide.ts";
import { type VivRouteOptions, vivRendererFactory } from "./viv-route.ts";

export interface PixelRendererRouteOptions {
  readonly viv?: VivRouteOptions;
  readonly deckWebGpu?: DeckWebGpuRouteOptions;
  readonly customWebGpu?: CustomWebGpuRouteOptions;
}

export function pixelRendererRoutes(
  options: PixelRendererRouteOptions = {},
): RendererRouteLoaders<PixelSlide> {
  return {
    viv: () => vivRendererFactory(options.viv),
    "deck-webgpu": async () => {
      const { loadDeckWebGpuRoute } = await import("../deck-webgpu/index.ts");
      return loadDeckWebGpuRoute(options.deckWebGpu);
    },
    "custom-webgpu": async () => {
      const { loadCustomWebGpuRoute } = await import("../custom-webgpu/index.ts");
      return loadCustomWebGpuRoute(options.customWebGpu);
    },
  };
}
