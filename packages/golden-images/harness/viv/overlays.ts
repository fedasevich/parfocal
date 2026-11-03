import {
  createDefaultPixelSourceRegistry,
  createOverlayController,
  createViewerEngine,
  isHeatmapOverlay,
  type OverlayController,
  placedLabelBox,
  type ViewerEngine,
  withHeatmapLook,
  zoomForMagnification,
} from "@parfocal/viewer-engine";
import {
  type PixelSlide,
  pixelSlide,
  type VivRoute,
  vivRendererFactory,
} from "@parfocal/viewer-engine/viv";
import {
  idLabelPlacement,
  labelAnchors,
  labelOrigin,
  type OverlayGeometry,
  overlayFixture,
} from "./overlay-fixtures.ts";
import {
  type LabelReport,
  type OverlayChange,
  type OverlayHarness,
  type OverlayRenderRequest,
  type OverlayRenderResult,
  overlayHarnessGlobal,
  type ResourceWatch,
} from "./overlay-protocol.ts";

const registry = createDefaultPixelSourceRegistry();

function viewer(): HTMLElement {
  const element = document.getElementById("viewer");
  if (element === null) throw new Error("The harness page has no #viewer element");
  return element;
}

interface Destroyable {
  readonly destroyed?: boolean;
  readonly _destroyed?: boolean;
}

const isDestroyed = (resource: Destroyable): boolean =>
  resource.destroyed === true || resource._destroyed === true;

interface InspectableLayer {
  readonly id: string;
  getModels(): readonly Destroyable[];
  getAttributeManager(): {
    getAttributes(): Record<string, { getBuffer(): Destroyable | null }>;
  } | null;
}

let watching: Destroyable[] = [];
let engine: ViewerEngine | null = null;
let route: VivRoute | null = null;
let layers: OverlayController | null = null;
let shown: OverlayGeometry | null = null;
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
  route = null;
  layers = null;
  shown = null;
  watching = [];
  errors.length = 0;
};

const watch = (id: string): ResourceWatch => {
  if (route === null) throw new Error("Nothing is rendered yet");
  const manager = (route.deck as unknown as { layerManager: { getLayers(): InspectableLayer[] } })
    .layerManager;
  watching = [];
  for (const layer of manager.getLayers()) {
    if (!layer.id.startsWith(`overlay:${id}:`)) continue;
    watching.push(...layer.getModels());
    const attributes = layer.getAttributeManager()?.getAttributes() ?? {};
    for (const attribute of Object.values(attributes)) {
      const buffer = attribute.getBuffer();
      if (buffer !== null) watching.push(buffer);
    }
  }
  return watched();
};

const watched = (): ResourceWatch => ({
  watched: watching.length,
  destroyed: watching.filter(isDestroyed).length,
});

const settle = async (): Promise<OverlayRenderResult> => {
  if (route === null || layers === null) throw new Error("Nothing is rendered yet");
  await route.whenIdle();
  return { errors: [...errors], layerIds: layers.list().map((layer) => layer.id) };
};

const render = async (request: OverlayRenderRequest): Promise<OverlayRenderResult> => {
  reset();
  const factory = vivRendererFactory({
    onError: (error) => {
      errors.push(error.message);
    },
  });
  const current = createViewerEngine<PixelSlide>({
    createRenderer: (container) => {
      route = factory(container);
      return route;
    },
    openSlide: async (ref, signal) => {
      const openRequest = { formatId: request.formatId, url: request.url };
      const source = await registry.open({ ...openRequest, signal });
      return pixelSlide(ref.id, source, openRequest);
    },
  });
  engine = current;
  const controller = createOverlayController(current);
  layers = controller;
  const zoom = zoomForMagnification(request.micronsPerPixel, request.magnification);
  const geometry: OverlayGeometry = {
    centre: request.centre,
    slidePerScreen: 2 ** -zoom,
    viewport: request.viewport,
  };
  shown = geometry;
  const ordered = request.reverse ? [...request.layers].reverse() : request.layers;
  const register = () => {
    for (const kind of ordered) controller.set(overlayFixture(kind, geometry, request.heatmap));
  };
  if (request.registration === "before-mount") register();
  current.mount(viewer());
  await current.openSlide({ id: request.url });
  if (request.registration === "after-open") register();
  current.setCamera({ ...request.centre, zoom });
  return settle();
};

const change = async (operation: OverlayChange): Promise<OverlayRenderResult> => {
  if (layers === null) throw new Error("Nothing is rendered yet");
  if (operation.kind === "visible") layers.setVisible(operation.id, operation.visible);
  if (operation.kind === "opacity") layers.setOpacity(operation.id, operation.opacity);
  if (operation.kind === "heatmap") {
    const overlay = layers.get(operation.id);
    if (overlay === undefined || !isHeatmapOverlay(overlay)) {
      throw new Error(`${operation.id} is not a heatmap`);
    }
    layers.set(withHeatmapLook(overlay, operation.look));
  }
  if (operation.kind === "remove") layers.remove(operation.id);
  if (operation.kind === "invalidate") layers.invalidate(operation.id);
  return settle();
};

const labels = (): LabelReport => {
  const geometry = shown;
  if (geometry === null) throw new Error("Nothing is rendered yet");
  const placement = idLabelPlacement(geometry);
  const origin = labelOrigin(geometry);
  return {
    boxes: placement.placed.map((label) => ({
      id: label.id,
      ...placedLabelBox(label, geometry.slidePerScreen, origin),
    })),
    anchors: labelAnchors(geometry).map((anchor) => ({
      id: anchor.id,
      x: (anchor.x - origin.x) / geometry.slidePerScreen,
      y: (anchor.y - origin.y) / geometry.slidePerScreen,
    })),
    hidden: placement.hidden,
    viewport: geometry.viewport,
  };
};

const harness: OverlayHarness = { render, watch, watched, change, reset, labels };
Object.assign(globalThis, { [overlayHarnessGlobal]: harness });
