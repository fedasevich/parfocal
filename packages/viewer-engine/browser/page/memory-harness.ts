import { Deck } from "@deck.gl/core";
import { XRLayer } from "@hms-dbmi/viv";
import {
  createDefaultPixelSourceRegistry,
  createViewerEngine,
  type SlideFormatId,
  type ViewerEngine,
} from "../../src/index.ts";
import { installUint8TextureUpload } from "../../src/viv/deck-settings.ts";
import { disposeDeck, releaseDevice } from "../../src/viv/dispose-deck.ts";
import {
  createMemoryRoute,
  type MemoryRoute,
  type MemorySlide,
  type ReleaseDeck,
} from "./memory-route.ts";
import { vivLevels } from "./viv-levels.ts";

export interface HarnessSlide {
  readonly id: string;
  readonly formatId: SlideFormatId;
  readonly url: string;
}

export interface VisitReport {
  readonly id: string;
  readonly openMs: number;
  readonly loadTimeouts: number;
  readonly canvases: number;
}

export interface MemoryHarness {
  readonly release: "wrapper" | "stock" | "no-canvas-context";
  readonly prototypes: { deck: object; device: object | null; canvasContext: object | null };
  readonly contexts: { created: number; lost: number };
  visit(slide: HarnessSlide): Promise<VisitReport>;
  dispose(): number;
}

declare global {
  interface Window {
    memoryHarness: MemoryHarness;
  }
}

const loadTimeoutMs = 15_000;

const stockRelease: ReleaseDeck = (deck, canvas) => {
  deck.finalize();
  canvas.remove();
};

const withoutCanvasContext: ReleaseDeck = (deck, canvas) => {
  const device = (deck as unknown as { device?: { gl?: WebGL2RenderingContext } }).device;
  deck.finalize();
  releaseDevice(device?.gl ? { gl: device.gl } : null);
  canvas.width = 0;
  canvas.height = 0;
  canvas.remove();
};

const releases: Record<MemoryHarness["release"], ReleaseDeck> = {
  wrapper: disposeDeck,
  stock: stockRelease,
  "no-canvas-context": withoutCanvasContext,
};

function readRelease(value: string | null): MemoryHarness["release"] {
  return value === "stock" || value === "no-canvas-context" ? value : "wrapper";
}

const params = new URLSearchParams(location.search);
const release = readRelease(params.get("release"));
if (params.get("uint8") !== "stock") installUint8TextureUpload(XRLayer);

const contexts = { created: 0, lost: 0 };
type GetContext = (this: HTMLCanvasElement, ...args: unknown[]) => RenderingContext | null;
const getContext = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "getContext")
  ?.value as GetContext;
HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: unknown[]) {
  const known = (this as { counted?: boolean }).counted === true;
  const context = getContext.apply(this, args);
  if (context && !known && args[0] === "webgl2") {
    (this as { counted?: boolean }).counted = true;
    contexts.created += 1;
    this.addEventListener("webglcontextlost", () => {
      contexts.lost += 1;
    });
  }
  return context;
} as typeof HTMLCanvasElement.prototype.getContext;

const prototypes: MemoryHarness["prototypes"] = {
  deck: Deck.prototype,
  device: null,
  canvasContext: null,
};

const container = document.createElement("div");
container.id = "viewer";
container.style.position = "fixed";
container.style.inset = "0";
document.body.append(container);

const registry = createDefaultPixelSourceRegistry();
const refs = new Map<string, HarnessSlide>();
let route: MemoryRoute | null = null;

const engine: ViewerEngine = createViewerEngine<MemorySlide>({
  createRenderer: (host) => {
    route = createMemoryRoute(host, {
      release: releases[release],
      onDevice: (device) => {
        const canvasContext = (device as { canvasContext?: object | null }).canvasContext;
        prototypes.device ??= Object.getPrototypeOf(device) as object;
        if (canvasContext)
          prototypes.canvasContext ??= Object.getPrototypeOf(canvasContext) as object;
      },
    });
    return route;
  },
  openSlide: async (ref, signal) => {
    const slide = refs.get(ref.id);
    if (!slide) throw new Error(`Unknown slide ${ref.id}`);
    const source = await registry.open({ formatId: slide.formatId, url: slide.url, signal });
    const base = source.levels[0];
    if (!base) throw new Error(`${ref.id} has no levels`);
    return {
      id: ref.id,
      width: base.width,
      height: base.height,
      micronsPerPixel: source.micronsPerPixel?.x ?? null,
      levels: vivLevels(source),
      close: () => source.close(),
    };
  },
});
engine.mount(container);

async function settle(): Promise<number> {
  const shown = route;
  if (!shown) throw new Error("The engine is not mounted");
  return (await shown.whenLoaded(loadTimeoutMs)) ? 0 : 1;
}

window.memoryHarness = {
  release,
  prototypes,
  contexts,
  async visit(slide) {
    refs.set(slide.id, slide);
    const started = performance.now();
    await engine.openSlide({ id: slide.id });
    let loadTimeouts = await settle();
    const openMs = performance.now() - started;
    const fitted = engine.getCamera();
    engine.setCamera({ ...fitted, zoom: Math.min(0, fitted.zoom + 2) });
    loadTimeouts += await settle();
    engine.setCamera({ ...fitted, zoom: 0 });
    loadTimeouts += await settle();
    engine.fitToSlide();
    loadTimeouts += await settle();
    return {
      id: slide.id,
      openMs,
      loadTimeouts,
      canvases: container.querySelectorAll("canvas").length,
    };
  },
  dispose() {
    engine.dispose();
    route = null;
    return container.querySelectorAll("canvas").length;
  },
};
