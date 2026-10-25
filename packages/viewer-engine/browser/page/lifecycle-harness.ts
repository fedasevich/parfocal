import "./frame-probe.ts";
import { Deck } from "@deck.gl/core";
import {
  type Camera,
  createViewerEngine,
  type FlightEnd,
  type SlideFormatId,
  type ViewerEngine,
  zoomForMagnification,
} from "../../src/index.ts";
import {
  createPixelSlideOpener,
  type DeckSleepStats,
  type PixelSlide,
  type VivRoute,
  vivRendererFactory,
} from "../../src/viv/index.ts";

export interface LifecycleSlide {
  readonly url: string;
  readonly formatId: SlideFormatId;
  readonly workers: number;
  readonly magnification: number;
  readonly x: number;
  readonly y: number;
  readonly sleepWhenIdle: boolean;
}

export interface LifecycleState {
  readonly camera: Camera;
  readonly motion: string;
  readonly settled: boolean;
  readonly asleep: boolean;
  readonly sleep: DeckSleepStats | null;
  readonly notifications: number;
  readonly errors: readonly string[];
}

export interface FlightState {
  readonly end: FlightEnd | null;
  readonly settledAtMs: number | null;
  readonly camera: Camera;
}

export interface LifecycleHarness {
  readonly prototypes: { readonly deck: object };
  open(slide: LifecycleSlide): Promise<void>;
  settle(timeoutMs: number): Promise<void>;
  state(): LifecycleState;
  moveTo(camera: Camera): void;
  startFlight(target: Camera): void;
  flight(): FlightState;
  waitUntilComplete(timeoutMs: number): Promise<number>;
  close(): void;
}

declare global {
  interface Window {
    lifecycleHarness: LifecycleHarness;
  }
}

const errors: string[] = [];
let engine: ViewerEngine | null = null;
let route: VivRoute | null = null;
let notifications = 0;
let flight: { end: FlightEnd | null; settledAtMs: number | null; started: number } | null = null;

globalThis.addEventListener("unhandledrejection", (event) => {
  errors.push(String(event.reason));
});

function viewer(): HTMLElement {
  const element = document.getElementById("viewer");
  if (element === null) throw new Error("The lifecycle page has no #viewer element");
  return element;
}

function mounted(): { engine: ViewerEngine; route: VivRoute } {
  if (engine === null || route === null) throw new Error("No slide is open");
  return { engine, route };
}

async function open(slide: LifecycleSlide): Promise<void> {
  close();
  const factory = vivRendererFactory({
    decodeWorkers: slide.workers,
    useDevicePixels: 1,
    sleepWhenIdle: slide.sleepWhenIdle,
    onError: (error) => {
      errors.push(error.message);
    },
  });
  const current = createViewerEngine<PixelSlide>({
    createRenderer: (container) => {
      route = factory(container);
      return route;
    },
    openSlide: createPixelSlideOpener(() => ({ formatId: slide.formatId, url: slide.url })),
  });
  engine = current;
  current.subscribeCamera(() => {
    notifications++;
  });
  current.mount(viewer());
  const opened = await current.openSlide({ id: slide.url });
  if (opened.micronsPerPixel === null) throw new Error("The slide has no pixel size");
  current.setCamera({
    x: slide.x,
    y: slide.y,
    zoom: zoomForMagnification(opened.micronsPerPixel, slide.magnification),
  });
}

async function waitUntilComplete(timeoutMs: number): Promise<number> {
  const { route: shown } = mounted();
  const started = performance.now();
  while (!(shown.isSettled() && shown.sleep?.asleep())) {
    if (performance.now() - started > timeoutMs) {
      throw new Error(`The view was not complete after ${timeoutMs} ms`);
    }
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 10));
  }
  return performance.now() - started;
}

function close(): void {
  engine?.dispose();
  engine = null;
  route = null;
  notifications = 0;
  flight = null;
  errors.length = 0;
}

window.lifecycleHarness = {
  prototypes: { deck: Deck.prototype },
  open,
  settle: (timeoutMs) => mounted().route.whenIdle(AbortSignal.timeout(timeoutMs)),
  state: () => {
    const { engine: current, route: shown } = mounted();
    return {
      camera: current.getCamera(),
      motion: current.getMotion(),
      settled: shown.isSettled(),
      asleep: shown.sleep?.asleep() ?? false,
      sleep: shown.sleep?.stats() ?? null,
      notifications,
      errors: [...errors],
    };
  },
  moveTo: (camera) => mounted().engine.setCamera(camera),
  startFlight: (target) => {
    const current = mounted().engine;
    const state = {
      end: null as FlightEnd | null,
      settledAtMs: null as number | null,
      started: performance.now(),
    };
    flight = state;
    void current.flyTo(target).then((end) => {
      state.end = end;
      state.settledAtMs = performance.now() - state.started;
    });
  },
  flight: () => ({
    end: flight?.end ?? null,
    settledAtMs: flight?.settledAtMs ?? null,
    camera: mounted().engine.getCamera(),
  }),
  waitUntilComplete,
  close,
};
