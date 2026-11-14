import type { RendererRouteLoaders } from "../engine/renderer-switch.ts";
import type { PixelSlide } from "./pixel-slide.ts";
import { type VivRouteOptions, vivRendererFactory } from "./viv-route.ts";

export interface PixelRendererRouteOptions {
  readonly viv?: VivRouteOptions;
}

export function pixelRendererRoutes(
  options: PixelRendererRouteOptions = {},
): RendererRouteLoaders<PixelSlide> {
  return {
    viv: () => vivRendererFactory(options.viv),
  };
}
