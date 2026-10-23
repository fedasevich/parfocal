import { Deck, type Layer, OrthographicView } from "@deck.gl/core";
import { MultiscaleImageLayer } from "@hms-dbmi/viv";
import type { Camera, EngineContainer, EngineSlide, RendererRoute } from "../../src/index.ts";
import {
  deckDeviceProps,
  stableSelections,
  unpickableLayerProps,
} from "../../src/viv/deck-settings.ts";
import type { VivLevel } from "./viv-levels.ts";

export interface MemorySlide extends EngineSlide {
  readonly levels: readonly VivLevel[];
}

export type ReleaseDeck = (deck: Deck<OrthographicView>, canvas: HTMLCanvasElement) => void;

export interface MemoryRouteHooks {
  readonly release: ReleaseDeck;
  readonly onDevice: (device: unknown) => void;
}

export interface MemoryRoute extends RendererRoute<MemorySlide> {
  whenLoaded(timeoutMs: number): Promise<boolean>;
}

const view = new OrthographicView({ id: "slide", controller: false });

function viewState(camera: Camera) {
  return { target: [camera.x, camera.y, 0] as [number, number, number], zoom: camera.zoom };
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

export function createMemoryRoute(
  container: EngineContainer,
  hooks: MemoryRouteHooks,
): MemoryRoute {
  if (!(container instanceof HTMLElement))
    throw new Error("The memory route needs a DOM container");
  let camera: Camera = { x: 0, y: 0, zoom: 0 };
  let current: {
    deck: Deck<OrthographicView>;
    canvas: HTMLCanvasElement;
    layer: Layer;
  } | null = null;

  const release = () => {
    if (!current) return;
    const { deck, canvas } = current;
    current = null;
    hooks.release(deck, canvas);
  };

  const layerFor = (slide: MemorySlide): Layer => {
    const created: unknown = new MultiscaleImageLayer({
      id: `slide-${slide.id}`,
      loader: slide.levels,
      selections: stableSelections(slide, [{}]),
      channelsVisible: [true],
      ...unpickableLayerProps,
    } as never);
    return created as Layer;
  };

  return {
    showSlide(slide) {
      release();
      if (!slide) return;
      const canvas = document.createElement("canvas");
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      canvas.style.display = "block";
      container.append(canvas);
      const layer = layerFor(slide);
      const deck = new Deck<OrthographicView>({
        canvas,
        deviceProps: deckDeviceProps,
        views: view,
        viewState: viewState(camera),
        useDevicePixels: 1,
        layers: [layer],
        onDeviceInitialized: hooks.onDevice,
        onError: (error) => {
          console.error(error);
        },
      });
      current = { deck, canvas, layer };
    },
    setCamera(next) {
      camera = next;
      current?.deck.setProps({ viewState: viewState(camera) });
    },
    setOverlays() {},
    invalidateOverlay() {},
    destroy: release,
    async whenLoaded(timeoutMs) {
      const deadline = performance.now() + timeoutMs;
      let settled = 0;
      while (performance.now() < deadline) {
        await nextFrame();
        const shown = current;
        const loaded = Boolean(shown?.deck.isInitialized && shown.layer.isLoaded);
        settled = loaded ? settled + 1 : 0;
        if (settled >= 3) return true;
      }
      return false;
    },
  };
}
