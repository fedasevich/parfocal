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
  readonly viewers: number;
  readonly prototypes: { deck: object; device: object | null; canvasContext: object | null };
  readonly contexts: { created: number; lost: number };
  visit(slides: readonly HarnessSlide[]): Promise<VisitReport>;
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

const viewers = Math.max(1, Math.min(4, Number(params.get("viewers") ?? 1) || 1));

const grid = document.createElement("div");
grid.id = "viewer";
grid.style.position = "fixed";
grid.style.inset = "0";
grid.style.display = "grid";
grid.style.gridTemplateColumns = viewers > 1 ? "1fr 1fr" : "1fr";
grid.style.gridAutoRows = "1fr";
document.body.append(grid);

const registry = createDefaultPixelSourceRegistry();
const refs = new Map<string, HarnessSlide>();

interface Viewer {
  readonly container: HTMLElement;
  readonly engine: ViewerEngine;
  route: MemoryRoute | null;
}

function createViewer(): Viewer {
  const container = document.createElement("div");
  container.style.position = "relative";
  container.style.minWidth = "0";
  container.style.minHeight = "0";
  grid.append(container);
  const viewer: Viewer = {
    container,
    route: null,
    engine: createViewerEngine<MemorySlide>({
      createRenderer: (host) => {
        viewer.route = createMemoryRoute(host, {
          release: releases[release],
          onDevice: (device) => {
            const canvasContext = (device as { canvasContext?: object | null }).canvasContext;
            prototypes.device ??= Object.getPrototypeOf(device) as object;
            if (canvasContext)
              prototypes.canvasContext ??= Object.getPrototypeOf(canvasContext) as object;
          },
        });
        return viewer.route;
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
    }),
  };
  viewer.engine.mount(container);
  return viewer;
}

const panes = Array.from({ length: viewers }, createViewer);

async function settle(viewer: Viewer): Promise<number> {
  const shown = viewer.route;
  if (!shown) throw new Error("The engine is not mounted");
  return (await shown.whenLoaded(loadTimeoutMs)) ? 0 : 1;
}

async function settleAll(): Promise<number> {
  const timeouts = await Promise.all(panes.map(settle));
  return timeouts.reduce((sum, count) => sum + count, 0);
}

function eachViewer(change: (engine: ViewerEngine) => void): void {
  for (const viewer of panes) change(viewer.engine);
}

window.memoryHarness = {
  release,
  viewers,
  prototypes,
  contexts,
  async visit(slides) {
    const started = performance.now();
    await Promise.all(
      panes.map((viewer, index) => {
        const slide = slides[index];
        if (!slide) throw new Error(`No slide for viewer ${index}`);
        refs.set(slide.id, slide);
        return viewer.engine.openSlide({ id: slide.id });
      }),
    );
    let loadTimeouts = await settleAll();
    const openMs = performance.now() - started;
    const fitted = panes.map((viewer) => viewer.engine.getCamera());
    const zoomAll = (change: (zoom: number) => number) => {
      panes.forEach((viewer, index) => {
        const base = fitted[index];
        if (base) viewer.engine.setCamera({ ...base, zoom: change(base.zoom) });
      });
    };
    zoomAll((zoom) => Math.min(0, zoom + 2));
    loadTimeouts += await settleAll();
    zoomAll(() => 0);
    loadTimeouts += await settleAll();
    eachViewer((engine) => engine.fitToSlide());
    loadTimeouts += await settleAll();
    return {
      id: slides.map((slide) => slide.id).join("+"),
      openMs,
      loadTimeouts,
      canvases: grid.querySelectorAll("canvas").length,
    };
  },
  dispose() {
    eachViewer((engine) => engine.dispose());
    for (const viewer of panes) viewer.route = null;
    return grid.querySelectorAll("canvas").length;
  },
};
