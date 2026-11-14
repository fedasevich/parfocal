import { Deck } from "@deck.gl/core";
import {
  availableRendererRoutes,
  type Camera,
  createViewerEngine,
  type RendererRouteId,
  RendererRouteUnavailableError,
  type RoutedViewerEngine,
  type SlideFormatId,
} from "../../src/index.ts";
import {
  createPixelSlideOpener,
  type PixelSlide,
  pixelRendererRoutes,
} from "../../src/viv/index.ts";

export interface RouteSwitchSlide {
  readonly url: string;
  readonly formatId: SlideFormatId;
  readonly camera: Camera;
}

export interface RouteSwitchReport {
  readonly route: RendererRouteId;
  readonly camera: Camera;
  readonly canvases: number;
  readonly switchMs: number;
  readonly errors: readonly string[];
}

export interface RouteSwitchHarness {
  readonly prototypes: { readonly deck: object };
  routes(): readonly RendererRouteId[];
  open(slide: RouteSwitchSlide): Promise<RouteSwitchReport>;
  switchTo(route: RendererRouteId): Promise<RouteSwitchReport>;
  dispose(): number;
}

declare global {
  interface Window {
    routeSwitchHarness: RouteSwitchHarness;
  }
}

const idleTimeoutMs = 30_000;
const errors: string[] = [];

globalThis.addEventListener("unhandledrejection", (event) => {
  errors.push(String(event.reason));
});

const loaders = pixelRendererRoutes({
  viv: {
    useDevicePixels: 1,
    onError: (error) => {
      errors.push(error.message);
    },
  },
});

function viewer(): HTMLElement {
  const element = document.getElementById("viewer");
  if (element === null) throw new Error("The route switch page has no #viewer element");
  return element;
}

let engine: RoutedViewerEngine<PixelSlide> | null = null;
let shown: RendererRouteId | null = null;

async function factoryFor(route: RendererRouteId) {
  const load = loaders[route];
  if (load === undefined) throw new RendererRouteUnavailableError(route);
  return load();
}

function report(started: number): RouteSwitchReport {
  if (engine === null || shown === null) throw new Error("No slide is open");
  return {
    route: shown,
    camera: engine.getCamera(),
    canvases: viewer().querySelectorAll("canvas").length,
    switchMs: performance.now() - started,
    errors: [...errors],
  };
}

window.routeSwitchHarness = {
  prototypes: { deck: Deck.prototype },
  routes: () => availableRendererRoutes(loaders),
  async open(slide) {
    const started = performance.now();
    engine?.dispose();
    const first = availableRendererRoutes(loaders)[0];
    if (first === undefined) throw new Error("No renderer route is registered");
    const current = createViewerEngine<PixelSlide>({
      createRenderer: await factoryFor(first),
      openSlide: createPixelSlideOpener(() => ({ formatId: slide.formatId, url: slide.url })),
    });
    engine = current;
    shown = first;
    current.mount(viewer());
    await current.openSlide({ id: slide.url });
    current.setCamera(slide.camera);
    await current.whenIdle(AbortSignal.timeout(idleTimeoutMs));
    return report(started);
  },
  async switchTo(route) {
    if (engine === null) throw new Error("No slide is open");
    const started = performance.now();
    engine.switchRenderer(await factoryFor(route));
    shown = route;
    await engine.whenIdle(AbortSignal.timeout(idleTimeoutMs));
    return report(started);
  },
  dispose() {
    engine?.dispose();
    engine = null;
    shown = null;
    return viewer().querySelectorAll("canvas").length;
  },
};
