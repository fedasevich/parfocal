import { Deck, type Layer, OrthographicView } from "@deck.gl/core";
import { MultiscaleImageLayer } from "@hms-dbmi/viv";
import { type Camera, originCamera } from "../camera/camera.ts";
import { defaultDecodeWorkers } from "../decode/decode-pool.ts";
import { createRangeCache } from "../decode/range-cache.ts";
import {
  createWorkerRegionReader,
  type DecodeStats,
  type DecodeWorker,
  type WorkerRegionReader,
} from "../decode/worker-reader.ts";
import { animationFrames, systemClock } from "../engine/environment.ts";
import { createGuardedFrames } from "../engine/guarded-frames.ts";
import {
  defaultWatchdogMs,
  documentVisibility,
  messageTasks,
  systemTimers,
} from "../engine/scheduling.ts";
import type { EngineContainer, OverlayLayer, RendererRoute } from "../engine/types.ts";
import { createOverlayLayerBuilder } from "../overlay/deck/overlay-layers.ts";
import type { DecodeReport } from "../pixel-source/types.ts";
import { absoluteUrl } from "../pixel-source/url.ts";
import { observeCanvasSize, observePixelRatio } from "./canvas-observers.ts";
import { createDeckSleep, type DeckSleep } from "./deck-sleep.ts";
import { disposeDeck } from "./dispose-deck.ts";
import type { PixelSlide } from "./pixel-slide.ts";
import { createVivLevels, type VivLevels } from "./viv-levels.ts";

export const vivViewId = "slide";

const stableSelections = [{ z: 0, t: 0, c: 0 }];

const idleFramesRequired = 2;

const unpickable: object = { pickable: false };

interface FrameLoopHandle {
  setProps(props: { animationFrameProvider: DeckSleep["provider"] }): unknown;
}

function installFrameProvider(deck: Deck, sleep: DeckSleep): void {
  const loop = (deck as unknown as { animationLoop?: FrameLoopHandle | null }).animationLoop;
  loop?.setProps({ animationFrameProvider: sleep.provider });
}

export interface VivRouteOptions {
  readonly onError?: (error: Error) => void;
  readonly useDevicePixels?: boolean | number;
  readonly preserveDrawingBuffer?: boolean;
  readonly decodeWorkers?: number;
  readonly spawnDecodeWorker?: (index: number) => DecodeWorker;
  readonly sleepWhenIdle?: boolean;
}

export interface VivRoute extends RendererRoute<PixelSlide> {
  readonly canvas: HTMLCanvasElement;
  readonly deck: Deck<OrthographicView>;
  readonly whenIdle: (signal?: AbortSignal) => Promise<void>;
  readonly isSettled: () => boolean;
  readonly decodeStats: () => DecodeStats | null;
  readonly jpegReports: () => readonly (DecodeReport | null)[];
  readonly sleep: DeckSleep | null;
}

interface Shown {
  readonly slide: PixelSlide;
  readonly levels: VivLevels;
  readonly layer: Layer;
  readonly reader: WorkerRegionReader | null;
}

export function vivViewState(camera: Camera) {
  return { target: [camera.x, camera.y, 0] as [number, number, number], zoom: camera.zoom };
}

function hostElement(container: EngineContainer): HTMLElement {
  if (typeof HTMLElement === "undefined" || !(container instanceof HTMLElement)) {
    throw new Error("The Viv route needs an HTML element to mount on");
  }
  return container;
}

export function createVivRoute(
  container: EngineContainer,
  options: VivRouteOptions = {},
): VivRoute {
  const host = hostElement(container);
  const reportError =
    options.onError ??
    ((error: Error) => {
      console.error(error);
    });
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "display:block;width:100%;height:100%";
  host.append(canvas);

  let camera = originCamera;
  let shown: Shown | null = null;
  let overlays: readonly OverlayLayer[] = [];
  let overlayLayers: Layer[] = [];
  const overlayBuilder = createOverlayLayerBuilder();
  let changes = 0;
  let renderedChanges = -1;
  let destroyed = false;

  const deck = new Deck<OrthographicView>({
    canvas,
    views: new OrthographicView({ id: vivViewId, controller: false }),
    controller: false,
    viewState: vivViewState(camera),
    layers: [],
    useDevicePixels: options.useDevicePixels ?? true,
    deviceProps: {
      type: "webgl",
      webgl: { antialias: false, preserveDrawingBuffer: options.preserveDrawingBuffer ?? false },
    },
    onError: (error) => {
      reportError(error);
    },
    onAfterRender: () => {
      renderedChanges = changes;
    },
  });

  const workerCount = options.decodeWorkers ?? defaultDecodeWorkers;

  const readerFor = (slide: PixelSlide): WorkerRegionReader | null => {
    const opened = slide.opened;
    if (opened === null || workerCount < 1) return null;
    const reader = createWorkerRegionReader({
      request: {
        formatId: opened.formatId,
        url: absoluteUrl(opened.url, opened.baseUrl).href,
        ...(opened.index === undefined ? {} : { index: opened.index }),
        ...(typeof opened.nativeJpeg === "string" ? { nativeJpeg: opened.nativeJpeg } : {}),
      },
      size: workerCount,
      cache:
        slide.bytes ?? createRangeCache(opened.fetch === undefined ? {} : { fetch: opened.fetch }),
      ...(options.spawnDecodeWorker ? { spawn: options.spawnDecodeWorker } : {}),
    });
    reader.ready.catch((error: unknown) => {
      reportError(error instanceof Error ? error : new Error(String(error)));
    });
    reader.setFocus({ x: camera.x, y: camera.y });
    return reader;
  };

  const release = () => {
    shown?.reader?.dispose();
    shown = null;
  };

  const changed = () => {
    changes++;
    if (!documentVisibility.hidden()) deck.redraw("parfocal route change");
    sleep?.wake("change");
  };

  const applyLayers = () => {
    overlayLayers = overlayBuilder.build(overlays);
    deck.setProps({ layers: shown ? [shown.layer, ...overlayLayers] : [] });
    changed();
  };

  const showSlide = (slide: PixelSlide | null) => {
    if (slide === shown?.slide) return;
    release();
    if (slide === null) {
      applyLayers();
      return;
    }
    const reader = readerFor(slide);
    const levels = createVivLevels(slide.source, {
      onTileError: reportError,
      onReadSettled: () => sleep?.wake("read"),
      ...(reader ? { read: reader.read } : {}),
    });
    const layer = new MultiscaleImageLayer<[]>({
      id: `slide-${slide.id}`,
      loader: [...levels.levels],
      selections: stableSelections,
      contrastLimits: [],
      channelsVisible: [true],
      dtype: "Uint8",
      ...unpickable,
    }) as Layer;
    shown = { slide, levels, layer, reader };
    applyLayers();
  };

  const setCamera = (next: Camera) => {
    camera = next;
    shown?.reader?.setFocus({ x: camera.x, y: camera.y });
    deck.setProps({ viewState: vivViewState(camera) });
    changed();
  };

  const settled = (): boolean => {
    if (renderedChanges !== changes) return false;
    if (deck.needsRedraw({ clearRedrawFlags: false })) return false;
    if (shown === null) return true;
    return (
      shown.layer.isLoaded &&
      overlayLayers.every((layer) => layer.isLoaded) &&
      shown.levels.pending() === 0 &&
      (shown.reader?.idle() ?? true)
    );
  };

  const sleep: DeckSleep | null =
    options.sleepWhenIdle === false
      ? null
      : createDeckSleep({
          frames: createGuardedFrames({
            frames: animationFrames,
            visibility: documentVisibility,
            tasks: messageTasks,
            timers: systemTimers,
            watchdogMs: defaultWatchdogMs,
          }),
          visibility: documentVisibility,
          settled: () => settled(),
          now: systemClock,
        });
  if (sleep) installFrameProvider(deck as unknown as Deck, sleep);
  const stopObservingCanvas = observeCanvasSize(canvas, () => sleep?.wake("resize"));
  const stopObservingPixelRatio = observePixelRatio(() => sleep?.wake("resize"));

  const whenIdle = (signal?: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      let calm = 0;
      const check = () => {
        if (destroyed) {
          reject(new Error("The Viv route was destroyed before it settled"));
          return;
        }
        if (signal?.aborted) {
          reject(new Error("Waiting for the Viv route was aborted", { cause: signal.reason }));
          return;
        }
        const isSettled = settled();
        if (!isSettled) sleep?.wake("poll");
        calm = isSettled ? calm + 1 : 0;
        if (calm >= idleFramesRequired) {
          resolve();
          return;
        }
        requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    });

  return {
    canvas,
    deck,
    whenIdle,
    isSettled: settled,
    decodeStats: () => shown?.reader?.stats() ?? null,
    jpegReports: () => shown?.reader?.jpegReports() ?? [],
    sleep,
    showSlide,
    setCamera,
    setOverlays: (next) => {
      overlays = next;
      applyLayers();
    },
    invalidateOverlay: (id) => {
      if (!overlays.some((overlay) => overlay.id === id)) return;
      overlayBuilder.invalidate(id);
      applyLayers();
    },
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      release();
      stopObservingCanvas();
      stopObservingPixelRatio();
      disposeDeck(deck as unknown as Deck, canvas);
      sleep?.destroy();
    },
  };
}

export function vivRendererFactory(options: VivRouteOptions = {}) {
  return (container: EngineContainer): VivRoute => createVivRoute(container, options);
}
