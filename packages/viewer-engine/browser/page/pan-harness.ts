import {
  type Camera,
  createDefaultPixelSourceRegistry,
  createViewerEngine,
  type SlideFormatId,
  type ViewerEngine,
  zoomForMagnification,
} from "../../src/index.ts";
import {
  createPixelSlideOpener,
  type DecodeStats,
  type PixelSlide,
  pixelSlide,
  type VivRoute,
  vivRendererFactory,
} from "../../src/viv/index.ts";

export interface PanSlide {
  readonly url: string;
  readonly formatId: SlideFormatId;
  readonly workers: number;
  readonly reader: "shared-bytes" | "geotiff-direct";
  readonly magnification: number;
  readonly x: number;
  readonly y: number;
}

export interface PanLeg {
  readonly dx: number;
  readonly dy: number;
  readonly frames: number;
}

export interface PanReport {
  readonly frames: number;
  readonly elapsedMs: number;
  readonly settleMs: number;
  readonly camera: Camera;
  readonly decode: DecodeStats | null;
  readonly errors: readonly string[];
}

export interface PanHarness {
  open(slide: PanSlide): Promise<{ readonly decode: DecodeStats | null }>;
  pan(legs: readonly PanLeg[], settleTimeoutMs: number): Promise<PanReport>;
  close(): void;
}

declare global {
  interface Window {
    panHarness: PanHarness;
  }
}

const errors: string[] = [];
let engine: ViewerEngine | null = null;
let route: VivRoute | null = null;

globalThis.addEventListener("unhandledrejection", (event) => {
  errors.push(String(event.reason));
});

function viewer(): HTMLElement {
  const element = document.getElementById("viewer");
  if (element === null) throw new Error("The pan page has no #viewer element");
  return element;
}

function nextFrame(): Promise<number> {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

function mounted(): { engine: ViewerEngine; route: VivRoute } {
  if (engine === null || route === null) throw new Error("No slide is open");
  return { engine, route };
}

async function open(slide: PanSlide) {
  close();
  const factory = vivRendererFactory({
    decodeWorkers: slide.workers,
    useDevicePixels: 1,
    onError: (error) => {
      errors.push(error.message);
    },
  });
  const current = createViewerEngine<PixelSlide>({
    createRenderer: (container) => {
      route = factory(container);
      return route;
    },
    openSlide:
      slide.reader === "shared-bytes"
        ? createPixelSlideOpener(() => ({ formatId: slide.formatId, url: slide.url }))
        : async (ref, signal) => {
            const source = await createDefaultPixelSourceRegistry().open({
              formatId: slide.formatId,
              url: slide.url,
              signal,
            });
            return pixelSlide(ref.id, source);
          },
  });
  engine = current;
  current.mount(viewer());
  const opened = await current.openSlide({ id: slide.url });
  if (opened.micronsPerPixel === null) throw new Error("The slide has no pixel size");
  current.setCamera({
    x: slide.x,
    y: slide.y,
    zoom: zoomForMagnification(opened.micronsPerPixel, slide.magnification),
  });
  await mounted().route.whenIdle();
  return { decode: mounted().route.decodeStats() };
}

async function pan(legs: readonly PanLeg[], settleTimeoutMs: number): Promise<PanReport> {
  const { engine: current, route: shown } = mounted();
  const started = performance.now();
  let frames = 0;
  for (const leg of legs) {
    for (let frame = 0; frame < leg.frames; frame++) {
      await nextFrame();
      const camera = current.getCamera();
      const scale = 2 ** camera.zoom;
      current.setCamera({
        x: camera.x + leg.dx / scale,
        y: camera.y + leg.dy / scale,
        zoom: camera.zoom,
      });
      frames++;
    }
  }
  const moved = performance.now();
  await shown.whenIdle(AbortSignal.timeout(settleTimeoutMs));
  const settled = performance.now();
  return {
    frames,
    elapsedMs: moved - started,
    settleMs: settled - moved,
    camera: current.getCamera(),
    decode: shown.decodeStats(),
    errors: [...errors],
  };
}

function close(): void {
  engine?.dispose();
  engine = null;
  route = null;
  errors.length = 0;
}

window.panHarness = { open, pan, close };
