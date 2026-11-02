import { createViewerEngine } from "../engine/engine.ts";
import type { SlideInfo, ViewerEngine } from "../engine/types.ts";
import { bindViewerInput, type ViewerInputBinding } from "../input/dom-input.ts";
import {
  createDefaultPixelSourceRegistry,
  type PixelSourceRegistry,
} from "../pixel-source/registry.ts";
import {
  createPixelSlideOpener,
  type OpenRequestResolver,
  type PixelSlide,
} from "./pixel-slide.ts";
import { type VivRoute, type VivRouteOptions, vivRendererFactory } from "./viv-route.ts";

export interface SlideViewportOptions {
  readonly container: HTMLElement;
  readonly slideId: string;
  readonly resolve: OpenRequestResolver;
  readonly registry?: PixelSourceRegistry;
  readonly route?: VivRouteOptions;
}

export interface SlideViewport {
  readonly engine: ViewerEngine;
  readonly ready: Promise<SlideInfo>;
  readonly route: () => VivRoute | null;
  readonly dispose: () => void;
}

export function mountSlideViewport(options: SlideViewportOptions): SlideViewport {
  const factory = vivRendererFactory(options.route);
  let route: VivRoute | null = null;
  const engine = createViewerEngine<PixelSlide>({
    createRenderer: (container) => {
      route = factory(container);
      return route;
    },
    openSlide: createPixelSlideOpener(
      options.resolve,
      options.registry ?? createDefaultPixelSourceRegistry(),
    ),
  });
  engine.mount(options.container);
  const input: ViewerInputBinding = bindViewerInput(options.container, engine);
  const ready = engine.openSlide({ id: options.slideId });
  ready.catch(() => undefined);
  return {
    engine,
    ready,
    route: () => route,
    dispose: () => {
      input.dispose();
      engine.dispose();
    },
  };
}
