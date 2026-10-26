import {
  createOverlayController,
  createViewerEngine,
  type OverlayController,
  type ViewerEngine,
  zoomForMagnification,
} from "@parfocal/viewer-engine";
import {
  createPixelSlideOpener,
  type PixelSlide,
  type VivRoute,
  vivRendererFactory,
} from "@parfocal/viewer-engine/viv";
import {
  type GpuLossHarness,
  type GpuLossRequest,
  type GpuLossState,
  gpuLossHarnessGlobal,
} from "./gpu-loss-protocol.ts";
import { type OverlayGeometry, overlayFixture } from "./overlay-fixtures.ts";

const contextEvents = new Set(["webglcontextlost", "webglcontextrestored"]);

const tracked = new Set<EventListenerOrEventListenerObject>();
const addListener = Reflect.get(
  HTMLCanvasElement.prototype,
  "addEventListener",
) as EventTarget["addEventListener"];
const removeListener = Reflect.get(
  HTMLCanvasElement.prototype,
  "removeEventListener",
) as EventTarget["removeEventListener"];

HTMLCanvasElement.prototype.addEventListener = function (
  this: HTMLCanvasElement,
  type: string,
  listener: EventListenerOrEventListenerObject | null,
  options?: boolean | AddEventListenerOptions,
) {
  if (listener && contextEvents.has(type) && typeof listener === "function") {
    if (listener.name === "lost" || listener.name === "restored") tracked.add(listener);
  }
  addListener.call(this, type, listener, options);
} as typeof addListener;

HTMLCanvasElement.prototype.removeEventListener = function (
  this: HTMLCanvasElement,
  type: string,
  listener: EventListenerOrEventListenerObject | null,
  options?: boolean | EventListenerOptions,
) {
  if (listener) tracked.delete(listener);
  removeListener.call(this, type, listener, options);
} as typeof removeListener;

interface LoseContextExtension {
  loseContext(): void;
  restoreContext(): void;
}

function viewer(): HTMLElement {
  const element = document.getElementById("viewer");
  if (element === null) throw new Error("The harness page has no #viewer element");
  return element;
}

let engine: ViewerEngine | null = null;
let route: VivRoute | null = null;
let layers: OverlayController | null = null;
let pendingRestore: LoseContextExtension | null = null;
let deckPrototype: object | null = null;
const errors: Error[] = [];

globalThis.addEventListener("error", (event) => {
  errors.push(new Error(String(event.message)));
});
globalThis.addEventListener("unhandledrejection", (event) => {
  errors.push(new Error(String(event.reason)));
});

function mounted(): { engine: ViewerEngine; route: VivRoute } {
  if (engine === null || route === null) throw new Error("No slide is open");
  return { engine, route };
}

function dispose(): void {
  engine?.dispose();
  engine = null;
  route = null;
  layers = null;
  pendingRestore = null;
  errors.length = 0;
}

async function open(request: GpuLossRequest): Promise<void> {
  dispose();
  const factory = vivRendererFactory({
    ...(request.restoreTimeoutMs === undefined
      ? {}
      : { restoreTimeoutMs: request.restoreTimeoutMs }),
    ...(request.sleepWhenIdle === undefined ? {} : { sleepWhenIdle: request.sleepWhenIdle }),
    onError: (error) => {
      errors.push(error);
    },
  });
  const current = createViewerEngine<PixelSlide>({
    createRenderer: (container) => {
      route = factory(container);
      return route;
    },
    openSlide: createPixelSlideOpener(() => ({ formatId: request.formatId, url: request.url })),
  });
  engine = current;
  const controller = createOverlayController(current);
  layers = controller;
  const zoom = zoomForMagnification(request.micronsPerPixel, request.magnification);
  if (request.withOverlay) {
    const geometry: OverlayGeometry = {
      centre: request.centre,
      slidePerScreen: 2 ** -zoom,
      viewport: { width: 800, height: 600 },
    };
    controller.set(overlayFixture("ai-proposals", geometry));
  }
  current.mount(viewer());
  deckPrototype = Object.getPrototypeOf(mounted().route.deck) as object;
  await current.openSlide({ id: request.url });
  current.setCamera({ ...request.centre, zoom });
}

function loseContext(): Promise<void> {
  const { route: shown } = mounted();
  const canvas = shown.canvas;
  const gl = canvas.getContext("webgl2");
  const extension = gl?.getExtension("WEBGL_lose_context");
  if (!extension) return Promise.reject(new Error("The context has no WEBGL_lose_context"));
  pendingRestore = extension;
  return new Promise((resolve) => {
    canvas.addEventListener("webglcontextlost", () => resolve(), { once: true });
    extension.loseContext();
  });
}

function restoreContext(): void {
  if (pendingRestore === null) throw new Error("No context is waiting to be restored");
  const extension = pendingRestore;
  pendingRestore = null;
  extension.restoreContext();
}

async function useRoute(): Promise<boolean> {
  const { engine: current, route: shown } = mounted();
  try {
    const camera = current.getCamera();
    current.setCamera({ ...camera, x: camera.x + 10 });
    shown.setOverlays([]);
    shown.invalidateOverlay("anything");
    shown.showSlide(null);
    await shown.whenIdle(AbortSignal.timeout(5000));
    return shown.isSettled();
  } catch {
    return false;
  }
}

function state(): GpuLossState {
  const { engine: current, route: shown } = mounted();
  const failure = shown.gpu.failure();
  const stats = shown.gpu.stats();
  return {
    camera: current.getCamera(),
    slideId: current.getSlide()?.id ?? null,
    status: shown.gpu.status(),
    losses: stats.losses,
    recoveries: stats.recoveries,
    failure: failure === null ? null : { reason: failure.reason, userMessage: failure.userMessage },
    errorNames: errors.map((error) => error.name),
    errorMessages: errors.map((error) => error.message),
    canvases: viewer().querySelectorAll("canvas").length,
    asleep: shown.sleep?.asleep() ?? false,
    settled: shown.isSettled(),
    overlayLayerIds: layers?.list().map((layer) => layer.id) ?? [],
    parfocalListeners: tracked.size,
  };
}

const harness: GpuLossHarness = {
  prototypes: {
    get deck() {
      if (deckPrototype === null) throw new Error("No viewer was opened");
      return deckPrototype;
    },
  },
  open,
  settle: (timeoutMs) => mounted().route.whenIdle(AbortSignal.timeout(timeoutMs)),
  state,
  loseContext,
  restoreContext,
  moveTo: (camera) => mounted().engine.setCamera(camera),
  useRoute,
  listeners: () => tracked.size,
  dispose,
};

Object.assign(globalThis, { [gpuLossHarnessGlobal]: harness });
