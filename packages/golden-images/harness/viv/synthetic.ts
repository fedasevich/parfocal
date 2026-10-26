import { createViewerEngine, type ViewerEngine } from "@parfocal/viewer-engine";
import {
  type PixelSlide,
  pixelSlide,
  type VivRoute,
  vivRendererFactory,
} from "@parfocal/viewer-engine/viv";
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

let engine: ViewerEngine | null = null;
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
    openSlide: (ref) => Promise.resolve(pixelSlide(ref.id, createSyntheticSource())),
  });
  engine = current;
  current.mount(viewer());
  await current.openSlide({ id: "synthetic" });
  current.setCamera(request.camera);
  const mounted = route as VivRoute | null;
  if (mounted === null) throw new Error("The route never mounted");
  await mounted.whenIdle();
  return { camera: current.getCamera(), errors: [...errors], textures: textureFilters(mounted) };
};

const harness: SyntheticHarness = { render, reset };
Object.assign(globalThis, { [syntheticHarnessGlobal]: harness });
