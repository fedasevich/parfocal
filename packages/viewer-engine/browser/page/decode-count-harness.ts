import {
  createDefaultPixelSourceRegistry,
  createViewerEngine,
  type PixelSource,
  type SlideFormatId,
  type ViewerEngine,
  zoomForMagnification,
} from "../../src/index.ts";
import {
  type PixelSlide,
  pixelSlide,
  type VivRoute,
  vivRendererFactory,
} from "../../src/viv/index.ts";

export interface DecodeCountRequest {
  readonly url: string;
  readonly formatId: SlideFormatId;
  readonly workers: number;
  readonly magnification: number | null;
  readonly x: number;
  readonly y: number;
}

export interface DecodeCountReport {
  readonly tileRequests: number;
  readonly rasterRequests: number;
  readonly distinctReads: number;
  readonly mostReadsOfOneRegion: number;
  readonly dispatchedToWorkers: number | null;
  readonly errors: readonly string[];
}

export interface DecodeCountHarness {
  run(request: DecodeCountRequest): Promise<DecodeCountReport>;
}

declare global {
  interface Window {
    decodeCountHarness: DecodeCountHarness;
  }
}

const registry = createDefaultPixelSourceRegistry();

function viewer(): HTMLElement {
  const element = document.getElementById("viewer");
  if (element === null) throw new Error("The decode count page has no #viewer element");
  return element;
}

function counting(
  source: PixelSource,
  reads: Map<string, number>,
  tally: { tiles: number; rasters: number },
): PixelSource {
  const note = (key: string) => reads.set(key, (reads.get(key) ?? 0) + 1);
  return {
    ...source,
    getTile: (request) => {
      tally.tiles++;
      note(`${request.level}/${request.x},${request.y}`);
      return source.getTile(request);
    },
    getRaster: (request) => {
      tally.rasters++;
      note(`${request.level}/${request.window?.join(",") ?? "all"}`);
      return source.getRaster(request);
    },
  };
}

async function run(request: DecodeCountRequest): Promise<DecodeCountReport> {
  const errors: string[] = [];
  const reads = new Map<string, number>();
  const tally = { tiles: 0, rasters: 0 };
  let route: VivRoute | null = null;
  const factory = vivRendererFactory({
    decodeWorkers: request.workers,
    useDevicePixels: 1,
    onError: (error) => {
      errors.push(error.message);
    },
  });
  const engine: ViewerEngine = createViewerEngine<PixelSlide>({
    createRenderer: (container) => {
      route = factory(container);
      return route;
    },
    openSlide: async (ref, signal) => {
      const opened = { formatId: request.formatId, url: request.url };
      const source = await registry.open({ ...opened, signal });
      return pixelSlide(ref.id, counting(source, reads, tally), opened);
    },
  });
  try {
    engine.mount(viewer());
    const slide = await engine.openSlide({ id: request.url });
    if (request.magnification !== null) {
      if (slide.micronsPerPixel === null) throw new Error("The slide has no pixel size");
      engine.setCamera({
        x: request.x,
        y: request.y,
        zoom: zoomForMagnification(slide.micronsPerPixel, request.magnification),
      });
    }
    const mounted = route as VivRoute | null;
    if (mounted === null) throw new Error("The route never mounted");
    await mounted.whenIdle();
    return {
      tileRequests: tally.tiles,
      rasterRequests: tally.rasters,
      distinctReads: reads.size,
      mostReadsOfOneRegion: Math.max(0, ...reads.values()),
      dispatchedToWorkers: mounted.decodeStats()?.dispatched ?? null,
      errors,
    };
  } finally {
    engine.dispose();
  }
}

window.decodeCountHarness = { run };
