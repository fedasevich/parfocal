import {
  createOverlayController,
  createViewerEngine,
  type ViewerEngine,
} from "@parfocal/viewer-engine";
import {
  type PixelSlide,
  pixelSlide,
  type VivRoute,
  vivRendererFactory,
} from "@parfocal/viewer-engine/viv";
import { outlineModeFixture, overlayFixture } from "./overlay-fixtures.ts";
import {
  type SyntheticHarness,
  type SyntheticRequest,
  type SyntheticResult,
  syntheticHarnessGlobal,
  type TextureFilter,
} from "./synthetic-protocol.ts";
import { createSyntheticSource } from "./synthetic-source.ts";

interface InspectableLayer {
  readonly props: { readonly tileId?: { readonly z?: number } };
  readonly state: {
    readonly bitmapTexture?: {
      readonly sampler?: {
        readonly props?: { readonly minFilter?: string; readonly magFilter?: string };
      };
    } | null;
  };
}

function viewer(): HTMLElement {
  const element = document.getElementById("viewer");
  if (element === null) throw new Error("The harness page has no #viewer element");
  return element;
}

function frames(count: number): Promise<void> {
  return new Promise((resolve) => {
    let left = count;
    const tick = () => {
      left -= 1;
      if (left <= 0) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

let engine: ViewerEngine | null = null;
let shownRoute: VivRoute | null = null;
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

function textureFilters(route: VivRoute): TextureFilter[] {
  const manager = (route.deck as unknown as { layerManager: { getLayers(): InspectableLayer[] } })
    .layerManager;
  const filters: TextureFilter[] = [];
  for (const layer of manager.getLayers()) {
    const texture = layer.state?.bitmapTexture;
    if (!texture) continue;
    filters.push({
      tileZoom: layer.props.tileId?.z ?? null,
      minFilter: texture.sampler?.props?.minFilter ?? null,
      magFilter: texture.sampler?.props?.magFilter ?? null,
    });
  }
  return filters;
}

const render = async (request: SyntheticRequest): Promise<SyntheticResult> => {
  reset();
  let route: VivRoute | null = null;
  const factory = vivRendererFactory({
    interpolation: request.interpolation,
    decodeWorkers: 0,
    onError: (error) => {
      errors.push(error.message);
    },
  });
  const current = createViewerEngine<PixelSlide>({
    createRenderer: (container) => {
      route = factory(container);
      return route;
    },
    openSlide: (ref) =>
      Promise.resolve(
        pixelSlide(
          ref.id,
          createSyntheticSource({
            ...(request.tiles?.hold ? { hold: request.tiles.hold } : {}),
            ...(request.tiles?.delayFinestMs === undefined
              ? {}
              : { delayFinestMs: request.tiles.delayFinestMs }),
          }),
        ),
      ),
  });
  engine = current;
  const host = viewer();
  host.style.filter = "";
  current.mount(host);
  await current.openSlide({ id: "synthetic" });
  current.setCamera(request.camera);
  const geometry = {
    centre: { x: request.camera.x, y: request.camera.y },
    slidePerScreen: 2 ** -request.camera.zoom,
    viewport: { width: host.clientWidth, height: host.clientHeight },
  };
  const overlays = createOverlayController(current);
  if (request.annotations) overlays.set(overlayFixture("human-annotations", geometry));
  if (request.outlineMode) {
    for (const overlay of outlineModeFixture(request.outlineMode, geometry)) overlays.set(overlay);
  }
  const brightness = request.brightness ?? 100;
  if (request.brightnessBy === "css-filter") host.style.filter = `brightness(${brightness / 100})`;
  else current.setSlideBrightness(brightness);
  const mounted = route as VivRoute | null;
  if (mounted === null) throw new Error("The route never mounted");
  shownRoute = mounted;
  if (request.tiles?.settle === false) await frames(24);
  else await mounted.whenIdle();
  return { camera: current.getCamera(), errors: [...errors], textures: textureFilters(mounted) };
};

const moveTo: SyntheticHarness["moveTo"] = async (camera) => {
  engine?.setCamera(camera);
  await frames(2);
};

const loadState: SyntheticHarness["loadState"] = () => {
  if (shownRoute === null) throw new Error("No route is showing a slide");
  return shownRoute.loadState();
};

const harness: SyntheticHarness = { render, moveTo, loadState, reset };
Object.assign(globalThis, { [syntheticHarnessGlobal]: harness });
