import type { DeckWebGpuRouteOptions } from "../deck-webgpu/deck-webgpu-route.ts";
import { createViewerEngine } from "../engine/engine.ts";
import {
  createRendererSwitcher,
  PRIMARY_RENDERER_ROUTE,
  type RendererRouteId,
  type RendererRouteLoaders,
  type RendererSwitchOutcome,
} from "../engine/renderer-switch.ts";
import type { RendererFactory, RendererRoute, SlideInfo, ViewerEngine } from "../engine/types.ts";
import {
  bindViewerInput,
  type ViewerInputBinding,
  type ViewerInputOptions,
} from "../input/dom-input.ts";
import {
  createDefaultPixelSourceRegistry,
  type PixelSourceRegistry,
} from "../pixel-source/registry.ts";
import {
  createPixelSlideOpener,
  type OpenRequestResolver,
  type PixelSlide,
} from "./pixel-slide.ts";
import { pixelRendererRoutes } from "./renderer-routes.ts";
import { type VivRoute, type VivRouteOptions, vivRendererFactory } from "./viv-route.ts";

export interface SlideViewportOptions {
  readonly container: HTMLElement;
  readonly slideId: string;
  readonly resolve: OpenRequestResolver;
  readonly registry?: PixelSourceRegistry;
  readonly route?: VivRouteOptions;
  readonly deckWebGpu?: DeckWebGpuRouteOptions;
  readonly routes?: RendererRouteLoaders<PixelSlide>;
  readonly input?: ViewerInputOptions;
}

export interface SlideViewport {
  readonly engine: ViewerEngine;
  readonly ready: Promise<SlideInfo>;
  readonly input: ViewerInputBinding;
  readonly route: () => VivRoute | null;
  readonly shownRoute: () => RendererRouteId;
  readonly liveRoute: () => RendererRoute<PixelSlide> | null;
  readonly availableRoutes: () => readonly RendererRouteId[];
  readonly switchRoute: (id: RendererRouteId) => Promise<RendererSwitchOutcome>;
  readonly dispose: () => void;
}

export function mountSlideViewport(options: SlideViewportOptions): SlideViewport {
  let live: RendererRoute<PixelSlide> | null = null;
  let liveId: RendererRouteId = PRIMARY_RENDERER_ROUTE;
  const tracked =
    (id: RendererRouteId, factory: RendererFactory<PixelSlide>): RendererFactory<PixelSlide> =>
    (container) => {
      const created = factory(container);
      live = created;
      liveId = id;
      return created;
    };
  const loaders =
    options.routes ??
    pixelRendererRoutes({
      ...(options.route === undefined ? {} : { viv: options.route }),
      ...(options.deckWebGpu === undefined ? {} : { deckWebGpu: options.deckWebGpu }),
    });
  const trackedLoaders: RendererRouteLoaders<PixelSlide> = {};
  for (const [id, load] of Object.entries(loaders) as [
    RendererRouteId,
    NonNullable<RendererRouteLoaders<PixelSlide>[RendererRouteId]>,
  ][]) {
    trackedLoaders[id] = async () => tracked(id, await load());
  }
  const engine = createViewerEngine<PixelSlide>({
    createRenderer: tracked(PRIMARY_RENDERER_ROUTE, vivRendererFactory(options.route)),
    openSlide: createPixelSlideOpener(
      options.resolve,
      options.registry ?? createDefaultPixelSourceRegistry(),
    ),
  });
  const switcher = createRendererSwitcher<PixelSlide>({ engine, routes: trackedLoaders });
  engine.mount(options.container);
  const input: ViewerInputBinding = bindViewerInput(options.container, engine, options.input);
  const ready = engine.openSlide({ id: options.slideId });
  ready.catch(() => undefined);
  return {
    engine,
    ready,
    input,
    route: () => (liveId === PRIMARY_RENDERER_ROUTE ? (live as VivRoute | null) : null),
    shownRoute: () => liveId,
    liveRoute: () => live,
    availableRoutes: switcher.available,
    switchRoute: switcher.switchTo,
    dispose: () => {
      input.dispose();
      engine.dispose();
    },
  };
}
