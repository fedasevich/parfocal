import {
  availableRendererRoutes,
  createDefaultPixelSourceRegistry,
  createViewerEngine,
  type PixelArray,
  type PixelResult,
  type PixelSource,
  type RasterRequest,
  type RendererFactory,
  type RendererRouteId,
  type RendererRouteLoaders,
  RendererRouteUnavailableError,
  type RoutedViewerEngine,
  zoomForMagnification,
} from "@parfocal/viewer-engine";
import {
  createVivLevels,
  type PixelSlide,
  pixelRendererRoutes,
  pixelSlide,
  type VivRoute,
  type VivRouteOptions,
  vivRendererFactory,
} from "@parfocal/viewer-engine/viv";
import {
  harnessGlobal,
  type VivBreakage,
  type VivHarness,
  type VivSceneRequest,
  type VivSceneResult,
} from "./protocol.ts";

const registry = createDefaultPixelSourceRegistry();

function swapRedAndBluePlanes(result: PixelResult): PixelResult {
  if (result.absent) return result;
  const [red, green, blue, ...rest] = result.planes;
  if (red === undefined || green === undefined || blue === undefined) return result;
  return { ...result, planes: [blue, green, red, ...rest] };
}

function withSwappedChannels(source: PixelSource): PixelSource {
  return {
    ...source,
    getTile: async (request) => swapRedAndBluePlanes(await source.getTile(request)),
    getRaster: async (request) => swapRedAndBluePlanes(await source.getRaster(request)),
  };
}

function rgbToYcbcr(result: PixelResult): PixelResult {
  if (result.absent) return result;
  const [red, green, blue] = result.planes;
  if (red === undefined || green === undefined || blue === undefined) return result;
  const count = result.width * result.height;
  const luma = new Uint8Array(count);
  const cb = new Uint8Array(count);
  const cr = new Uint8Array(count);
  for (let index = 0; index < count; index++) {
    const r = red[index] ?? 0;
    const g = green[index] ?? 0;
    const b = blue[index] ?? 0;
    luma[index] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    cb[index] = Math.round(128 - 0.168736 * r - 0.331264 * g + 0.5 * b);
    cr[index] = Math.round(128 + 0.5 * r - 0.418688 * g - 0.081312 * b);
  }
  return { ...result, planes: [luma, cb, cr] };
}

function withUnconvertedYcbcr(source: PixelSource): PixelSource {
  return {
    ...source,
    getTile: async (request) => rgbToYcbcr(await source.getTile(request)),
    getRaster: async (request) => rgbToYcbcr(await source.getRaster(request)),
  };
}

function padPlane(
  plane: PixelArray,
  from: { width: number; height: number },
  to: { width: number; height: number },
): Uint8Array {
  const padded = new Uint8Array(to.width * to.height).fill(255);
  for (let row = 0; row < from.height; row++) {
    for (let column = 0; column < from.width; column++) {
      padded[row * to.width + column] = plane[row * from.width + column] ?? 255;
    }
  }
  return padded;
}

function withLevelOneClaimedAsHalf(source: PixelSource): PixelSource {
  const [base, real] = source.levels;
  if (base === undefined || real === undefined) return source;
  const claimedDownsample = Math.max(2, real.downsample / 2);
  const claimed = {
    ...real,
    downsample: claimedDownsample,
    width: Math.ceil(base.width / claimedDownsample),
    height: Math.ceil(base.height / claimedDownsample),
  };
  const levels = source.levels.map((level, index) => (index === 1 ? claimed : level));
  const getRaster = async (request: RasterRequest): Promise<PixelResult> => {
    if (request.level !== 1 || request.window === undefined) return source.getRaster(request);
    const [x0, y0, x1, y1] = request.window;
    const wanted = { width: x1 - x0, height: y1 - y0 };
    const clamped = [x0, y0, Math.min(x1, real.width), Math.min(y1, real.height)] as const;
    if (clamped[2] <= x0 || clamped[3] <= y0) return { absent: true, ...wanted };
    const result = await source.getRaster({ ...request, window: clamped });
    if (result.absent) return { absent: true, ...wanted };
    return {
      absent: false,
      ...wanted,
      planes: result.planes.map((plane) => padPlane(plane, result, wanted)),
    };
  };
  return { ...source, levels, getRaster };
}

function broken(source: PixelSource, breakage: VivBreakage): PixelSource {
  if (breakage === "swap-red-blue") return withSwappedChannels(source);
  if (breakage === "wrong-level") return withLevelOneClaimedAsHalf(source);
  if (breakage === "ycbcr-as-rgb") return withUnconvertedYcbcr(source);
  return source;
}

function viewer(): HTMLElement {
  const element = document.getElementById("viewer");
  if (element === null) throw new Error("The harness page has no #viewer element");
  return element;
}

let engine: RoutedViewerEngine<PixelSlide> | null = null;
const errors: string[] = [];

globalThis.addEventListener("error", (event) => {
  errors.push(String(event.message));
});
globalThis.addEventListener("unhandledrejection", (event) => {
  errors.push(String(event.reason));
});

const reset = () => {
  engine?.dispose();
  engine = null;
  errors.length = 0;
};

interface HarnessRoutes {
  readonly loaders: RendererRouteLoaders<PixelSlide>;
  readonly viv: () => VivRoute | null;
}

function harnessRoutes(options: VivRouteOptions = {}): HarnessRoutes {
  const createViv = vivRendererFactory(options);
  let viv: VivRoute | null = null;
  return {
    loaders: {
      ...pixelRendererRoutes({ viv: options }),
      viv: () => (container) => {
        viv = createViv(container);
        return viv;
      },
    },
    viv: () => viv,
  };
}

async function loadRoute(
  loaders: RendererRouteLoaders<PixelSlide>,
  id: RendererRouteId,
): Promise<RendererFactory<PixelSlide>> {
  const load = loaders[id];
  if (load === undefined) throw new RendererRouteUnavailableError(id);
  return load();
}

const render = async (request: VivSceneRequest): Promise<VivSceneResult> => {
  reset();
  let opened: PixelSlide | null = null;
  const routes = harnessRoutes({
    ...(request.breakage === "linear-everywhere" ? { interpolation: "linear" as const } : {}),
    onError: (error) => {
      errors.push(error.message);
    },
  });
  let shown: RendererRouteId = request.route ?? "viv";
  const current = createViewerEngine<PixelSlide>({
    createRenderer: await loadRoute(routes.loaders, shown),
    openSlide: async (ref, signal) => {
      const openRequest = {
        formatId: request.formatId,
        url: request.url,
        ...(request.index === undefined ? {} : { index: request.index }),
        ...(request.breakage === "native-unvalidated"
          ? { nativeJpeg: "unvalidated" as const }
          : {}),
      };
      const source = await registry.open({ ...openRequest, signal });
      opened =
        request.breakage === "none" || request.breakage === "native-unvalidated"
          ? pixelSlide(ref.id, source, openRequest, null, request.tissue ?? null)
          : pixelSlide(ref.id, broken(source, request.breakage));
      return opened;
    },
  });
  engine = current;
  current.mount(viewer());
  const slide = await current.openSlide({ id: request.url });
  if (request.view.kind === "magnification") {
    if (slide.micronsPerPixel === null) throw new Error("The slide has no pixel size");
    current.setCamera({
      x: request.view.x,
      y: request.view.y,
      zoom: zoomForMagnification(slide.micronsPerPixel, request.view.magnification),
    });
  }
  if (request.view.kind === "camera") {
    current.setCamera({ x: request.view.x, y: request.view.y, zoom: request.view.zoom });
  }
  const openedSlide = opened as PixelSlide | null;
  if (openedSlide === null) throw new Error("The slide never opened");
  await current.whenIdle();
  for (const next of request.switches ?? []) {
    current.switchRenderer(await loadRoute(routes.loaders, next));
    shown = next;
    await current.whenIdle();
  }
  const viv = shown === "viv" ? routes.viv() : null;
  const { ladder, tileSize } = viv?.channels() ?? createVivLevels(openedSlide.source);
  const decodeStats = viv?.decodeStats() ?? null;
  return {
    route: shown,
    camera: current.getCamera(),
    slide: { width: slide.width, height: slide.height, micronsPerPixel: slide.micronsPerPixel },
    tileSize,
    ladder: ladder.map(({ downsample, backing }) => ({ downsample, backing })),
    errors: [...errors],
    jpeg: viv?.jpegReports() ?? [],
    decoded:
      decodeStats === null
        ? null
        : { workers: decodeStats.size, dispatched: decodeStats.dispatched },
  };
};

const routes = () => availableRendererRoutes(harnessRoutes().loaders);

const harness: VivHarness = { render, reset, routes };
Object.assign(globalThis, { [harnessGlobal]: harness });
