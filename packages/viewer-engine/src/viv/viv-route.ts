import { Deck, type Layer, OrthographicView } from "@deck.gl/core";
import { BitmapLayer as DeckBitmapLayer } from "@deck.gl/layers";
import { BitmapLayer, MultiscaleImageLayer } from "@hms-dbmi/viv";
import { type Camera, originCamera } from "../camera/camera.ts";
import type { MotionVector } from "../camera/motion-predictor.ts";
import { defaultDecodeWorkers, type PrefetchStats } from "../decode/decode-pool.ts";
import { createRangeCache } from "../decode/range-cache.ts";
import {
  createWorkerRegionReader,
  type DecodeStats,
  type DecodeWorker,
  disposingOnThrow,
  type WorkerRegionReader,
} from "../decode/worker-reader.ts";
import { slideTint } from "../engine/brightness.ts";
import { animationFrames, systemClock } from "../engine/environment.ts";
import { createGuardedFrames } from "../engine/guarded-frames.ts";
import {
  defaultWatchdogMs,
  documentVisibility,
  messageTasks,
  systemTimers,
} from "../engine/scheduling.ts";
import type { EngineContainer, OverlayLayer, RendererRoute } from "../engine/types.ts";
import { cameraViewRect, type ViewRect } from "../overlay/cull-grid.ts";
import { createOverlayLayerBuilder } from "../overlay/deck/overlay-layers.ts";
import type { DecodeReport } from "../pixel-source/types.ts";
import { absoluteUrl } from "../pixel-source/url.ts";
import { observeCanvasSize, observePixelRatio } from "./canvas-observers.ts";
import { createDeckSleep, type DeckSleep } from "./deck-sleep.ts";
import { disposeDeck } from "./dispose-deck.ts";
import type { FailedTile } from "./failed-tiles.ts";
import {
  createGpuGuard,
  type GpuGuardStats,
  type GpuStatus,
  type GpuUnrecoverableError,
} from "./gpu-recovery.ts";
import {
  defaultInterpolationRule,
  type InterpolationRule,
  installTileInterpolation,
  interpolationRuleProp,
} from "./interpolation.ts";
import type { PixelSlide } from "./pixel-slide.ts";
import { createPrefetcher, type Prefetcher } from "./prefetch.ts";
import { createTileFade, installTileFade, tileFadeProp } from "./tile-fade.ts";
import type { TileLoadState } from "./tile-wait.ts";
import {
  type ChannelDisplay,
  createVivChannelLevels,
  type VivChannelLevels,
  vivChannelLayerProps,
} from "./viv-channel-levels.ts";
import { createVivLevels, type VivLevels } from "./viv-levels.ts";

const idleLoadState: TileLoadState = { pending: 0, waitingMs: 0, answerMs: null };

export const vivViewId = "slide";

const stableSelections = [{ z: 0, t: 0, c: 0 }];

const channelInputs = new WeakMap<
  VivChannelLevels,
  { readonly loader: readonly unknown[]; readonly selections: readonly object[] }
>();

function stableChannelInputs(levels: VivChannelLevels, selections: readonly object[]) {
  const known = channelInputs.get(levels);
  if (known) return known;
  const created = { loader: [...levels.levels], selections: selections.map((s) => ({ ...s })) };
  channelInputs.set(levels, created);
  return created;
}

const idleFramesRequired = 2;

const unpickable: object = { pickable: false };

interface TilingLayer {
  readonly state?: {
    readonly tileset?: {
      readonly tiles: readonly {
        readonly index: { readonly x: number; readonly y: number; readonly z: number };
        readonly setNeedsReload: () => void;
      }[];
    };
  };
  readonly setNeedsUpdate: () => void;
}

interface FrameLoopHandle {
  setProps(props: { animationFrameProvider: DeckSleep["provider"] }): unknown;
}

function installFrameProvider(deck: Deck, sleep: DeckSleep): void {
  const loop = (deck as unknown as { animationLoop?: FrameLoopHandle | null }).animationLoop;
  loop?.setProps({ animationFrameProvider: sleep.provider });
}

export interface VivRouteOptions {
  readonly onError?: (error: Error) => void;
  readonly onTileError?: (error: Error) => void;
  readonly tileFade?: { readonly durationMs?: number; readonly now?: () => number };
  readonly useDevicePixels?: boolean | number;
  readonly preserveDrawingBuffer?: boolean;
  readonly decodeWorkers?: number;
  readonly spawnDecodeWorker?: (index: number) => DecodeWorker;
  readonly sleepWhenIdle?: boolean;
  readonly interpolation?: InterpolationRule;
  readonly restoreTimeoutMs?: number;
  readonly prefetch?: boolean;
}

export interface VivGpuState {
  readonly status: () => GpuStatus;
  readonly stats: () => GpuGuardStats;
  readonly failure: () => GpuUnrecoverableError | null;
}

export interface VivRoute extends RendererRoute<PixelSlide> {
  readonly canvas: HTMLCanvasElement;
  readonly deck: Deck<OrthographicView>;
  readonly whenIdle: (signal?: AbortSignal) => Promise<void>;
  readonly isSettled: () => boolean;
  readonly loadState: () => TileLoadState;
  readonly failedTiles: () => readonly FailedTile[];
  readonly retryTile: (key: string) => void;
  readonly decodeStats: () => DecodeStats | null;
  readonly residentTiles: () => number | null;
  readonly jpegReports: () => readonly (DecodeReport | null)[];
  readonly sleep: DeckSleep | null;
  readonly gpu: VivGpuState;
  readonly setPrefetch: (enabled: boolean) => void;
  readonly prefetchEnabled: () => boolean;
  readonly prefetchVector: () => MotionVector | null;
  readonly prefetchStats: () => PrefetchStats | null;
  readonly channels: () => VivChannelLevels | null;
  readonly setChannelDisplay: (display: readonly ChannelDisplay[]) => void;
}

function countResidentTiles(deck: unknown): number | null {
  const manager = (deck as { layerManager?: unknown }).layerManager as
    | { getLayers?: () => readonly unknown[] }
    | undefined;
  const layers = manager?.getLayers?.();
  if (layers === undefined) return null;
  let total = 0;
  let found = false;
  for (const layer of layers) {
    const tileset = (
      layer as { state?: { tileset?: { tiles?: readonly { isLoaded?: boolean }[] } } }
    ).state?.tileset;
    if (tileset?.tiles === undefined) continue;
    found = true;
    total += tileset.tiles.filter((tile) => tile.isLoaded === true).length;
  }
  return found ? total : null;
}

type RouteLevels = Pick<VivLevels, "pending" | "loadState" | "failures" | "clearFailure">;

interface Shown {
  readonly slide: PixelSlide;
  readonly levels: RouteLevels;
  readonly rgb: VivLevels | null;
  readonly channelLevels: VivChannelLevels | null;
  readonly layer: Layer;
  readonly reader: WorkerRegionReader | null;
  readonly prefetcher: Prefetcher | null;
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
  installTileInterpolation(BitmapLayer);
  installTileFade(DeckBitmapLayer);
  const tileFade = createTileFade(
    options.tileFade?.now ?? systemClock,
    options.tileFade?.durationMs,
  );
  const interpolationRule = options.interpolation ?? defaultInterpolationRule;
  const reportError =
    options.onError ??
    ((error: Error) => {
      console.error(error);
    });
  const createCanvas = () => {
    const element = document.createElement("canvas");
    element.style.cssText = "display:block;width:100%;height:100%";
    return element;
  };
  let canvas = createCanvas();
  host.append(canvas);

  let camera = originCamera;
  let shown: Shown | null = null;
  let overlays: readonly OverlayLayer[] = [];
  let overlayLayers: Layer[] = [];
  let overlayLod = "";
  let brightness = 1;
  let channelDisplay: readonly ChannelDisplay[] = [];
  let prefetchOn = options.prefetch ?? true;
  const overlayBuilder = createOverlayLayerBuilder();
  let changes = 0;
  let renderedChanges = -1;
  let destroyed = false;
  let failure: GpuUnrecoverableError | null = null;

  const deviceIsLost = (candidate: Deck<OrthographicView>): boolean => {
    const device = (candidate as unknown as { device?: { isLost?: boolean } | null }).device;
    return device?.isLost === true;
  };

  const gpuUsable = () => !destroyed && failure === null && guard.status() === "ready";

  const createDeck = (target: HTMLCanvasElement): Deck<OrthographicView> => {
    const created: Deck<OrthographicView> = new Deck<OrthographicView>({
      canvas: target,
      views: new OrthographicView({ id: vivViewId, controller: false }),
      controller: false,
      getCursor: () => "inherit",
      viewState: vivViewState(camera),
      layers: [],
      useDevicePixels: options.useDevicePixels ?? true,
      deviceProps: {
        type: "webgl",
        webgl: { antialias: false, preserveDrawingBuffer: options.preserveDrawingBuffer ?? false },
      },
      onError: (error) => {
        if (!gpuUsable() || deviceIsLost(created)) return;
        reportError(error);
      },
      onAfterRender: () => {
        renderedChanges = changes;
      },
    });
    return created;
  };

  let deck = createDeck(canvas);

  const workerCount = options.decodeWorkers ?? defaultDecodeWorkers;

  const readerFor = (slide: PixelSlide): WorkerRegionReader | null => {
    const opened = slide.opened;
    if (opened === null || workerCount < 1) return null;
    const reported = new Set<unknown>();
    const reportOnce = (error: unknown) => {
      if (reported.has(error)) return;
      reported.add(error);
      reportError(error instanceof Error ? error : new Error(String(error)));
    };
    const reader = createWorkerRegionReader({
      request: {
        formatId: opened.formatId,
        url: absoluteUrl(opened.url, opened.baseUrl).href,
        ...(opened.index === undefined ? {} : { index: opened.index }),
        ...(typeof opened.nativeJpeg === "string" ? { nativeJpeg: opened.nativeJpeg } : {}),
        levels: slide.source.levels.length,
      },
      size: workerCount,
      onFailure: reportOnce,
      cache:
        slide.bytes ?? createRangeCache(opened.fetch === undefined ? {} : { fetch: opened.fetch }),
      ...(options.spawnDecodeWorker ? { spawn: options.spawnDecodeWorker } : {}),
    });
    reader.ready.catch(reportOnce);
    reader.setFocus({ x: camera.x, y: camera.y });
    return reader;
  };

  const release = () => {
    shown?.reader?.dispose();
    shown = null;
  };

  const changed = () => {
    changes++;
    if (gpuUsable() && !documentVisibility.hidden()) deck.redraw("parfocal route change");
    sleep?.wake("change");
  };

  const viewRect = (): ViewRect | undefined =>
    cameraViewRect(camera, canvas.clientWidth, canvas.clientHeight);

  const overlayDetailMoved = (): boolean =>
    overlayBuilder.lodKey(overlays, 2 ** camera.zoom, viewRect()) !== overlayLod;

  const applyLayers = () => {
    if (failure !== null) return;
    const pixelsPerUnit = 2 ** camera.zoom;
    const rect = viewRect();
    overlayLod = overlayBuilder.lodKey(overlays, pixelsPerUnit, rect);
    overlayLayers = overlayBuilder.build(overlays, pixelsPerUnit, rect);
    if (gpuUsable()) deck.setProps({ layers: shown ? [shown.layer, ...overlayLayers] : [] });
    changed();
  };

  const slideLayer = (current: Pick<Shown, "slide" | "rgb" | "channelLevels">): Layer => {
    const extras = {
      ...unpickable,
      [interpolationRuleProp]: interpolationRule,
      [tileFadeProp]: tileFade,
    };
    if (current.channelLevels !== null) {
      const props = vivChannelLayerProps(current.channelLevels, channelDisplay);
      const stable = stableChannelInputs(current.channelLevels, props.selections);
      return new MultiscaleImageLayer<[]>({
        id: `slide-${current.slide.id}`,
        loader: stable.loader,
        selections: stable.selections,
        contrastLimits: props.contrastLimits.map((limits) => [...limits] as [number, number]),
        colors: props.colors.map((color) => [...color] as [number, number, number]),
        channelsVisible: [...props.channelsVisible],
        dtype: props.dtype,
        ...extras,
      } as never) as Layer;
    }
    return new MultiscaleImageLayer<[]>({
      id: `slide-${current.slide.id}`,
      loader: [...(current.rgb?.levels ?? [])],
      selections: stableSelections,
      contrastLimits: [],
      channelsVisible: [true],
      dtype: "Uint8",
      ...extras,
      ...{ tintColor: slideTint(brightness) },
    }) as Layer;
  };

  const channelShown = (slide: PixelSlide, reader: WorkerRegionReader | null): Shown => {
    const channelLevels = createVivChannelLevels(slide.source, {
      onTileError: options.onTileError ?? reportError,
      onReadSettled: () => sleep?.wake("read"),
      ...(reader ? { read: reader.readChannel } : {}),
    });
    const base = {
      slide,
      levels: channelLevels,
      rgb: null,
      channelLevels,
      reader,
      prefetcher: null,
    };
    return { ...base, layer: slideLayer(base) };
  };

  const rgbShown = (slide: PixelSlide, reader: WorkerRegionReader | null): Shown => {
    const levels = createVivLevels(slide.source, {
      onTileError: options.onTileError ?? reportError,
      onReadSettled: () => sleep?.wake("read"),
      ...(reader ? { read: reader.read } : {}),
    });
    const prefetcher = reader
      ? createPrefetcher({
          levels,
          target: reader,
          viewport: () =>
            canvas.clientWidth > 0 && canvas.clientHeight > 0
              ? { width: canvas.clientWidth, height: canvas.clientHeight }
              : null,
          now: systemClock,
          enabled: prefetchOn,
        })
      : null;
    const base = { slide, levels, rgb: levels, channelLevels: null, reader, prefetcher };
    return { ...base, layer: slideLayer(base) };
  };

  const showSlide = (slide: PixelSlide | null) => {
    if (failure !== null || slide === shown?.slide) return;
    release();
    if (slide === null) {
      applyLayers();
      return;
    }
    const reader = readerFor(slide);
    channelDisplay = [];
    shown = disposingOnThrow(reader, () =>
      slide.source.photometric === "rgb" ? rgbShown(slide, reader) : channelShown(slide, reader),
    );
    applyLayers();
  };

  const setCamera = (next: Camera) => {
    camera = next;
    shown?.reader?.setFocus({ x: camera.x, y: camera.y });
    shown?.prefetcher?.update(camera);
    if (gpuUsable()) deck.setProps({ viewState: vivViewState(camera) });
    if (overlayDetailMoved() && failure === null) applyLayers();
    else changed();
  };

  const resized = () => {
    sleep?.wake("resize");
    if (overlayDetailMoved()) applyLayers();
  };

  let fadeWasActive = false;

  const settled = (): boolean => {
    if (failure !== null) return true;
    if (!gpuUsable()) return false;
    if (tileFade.active()) {
      fadeWasActive = true;
      return false;
    }
    if (fadeWasActive) {
      fadeWasActive = false;
      changes++;
      deck.redraw("parfocal tile fade end");
      return false;
    }
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
  let stopObservingCanvas = observeCanvasSize(canvas, resized);
  const stopObservingPixelRatio = observePixelRatio(() => sleep?.wake("resize"));

  let deckDisposed = false;

  const disposeCurrentDeck = () => {
    if (deckDisposed) return;
    deckDisposed = true;
    stopObservingCanvas();
    disposeDeck(deck as unknown as Deck, canvas);
  };

  const stopDeckLoop = () => {
    const loop = (deck as unknown as { animationLoop?: { stop?: () => void } | null })
      .animationLoop;
    loop?.stop?.();
  };

  const rebuildAfterLoss = () => {
    const previous = { deck, canvas };
    stopObservingCanvas();
    const next = createCanvas();
    previous.canvas.after(next);
    canvas = next;
    guard.attach(next);
    disposeDeck(previous.deck as unknown as Deck, previous.canvas);
    deck = createDeck(next);
    if (sleep) installFrameProvider(deck as unknown as Deck, sleep);
    stopObservingCanvas = observeCanvasSize(next, resized);
    if (shown) shown = { ...shown, layer: slideLayer(shown) };
    applyLayers();
  };

  const guard = createGpuGuard({
    timers: systemTimers,
    visibility: documentVisibility,
    now: systemClock,
    ...(options.restoreTimeoutMs === undefined
      ? {}
      : { restoreTimeoutMs: options.restoreTimeoutMs }),
    onLost: () => {
      stopDeckLoop();
      sleep?.wake("change");
    },
    rebuild: rebuildAfterLoss,
    onUnrecoverable: (error) => {
      failure = error;
      release();
      disposeCurrentDeck();
      sleep?.wake("change");
      reportError(error);
    },
  });
  guard.attach(canvas);

  const retryTile = (key: string) => {
    const current = shown;
    const failure = current?.levels.failures().find((tile) => tile.key === key);
    if (!current || !failure) return;
    current.levels.clearFailure(key);
    const manager = (deck as unknown as { layerManager?: { getLayers(): TilingLayer[] } })
      .layerManager;
    for (const layer of manager?.getLayers() ?? []) {
      const tile = layer.state?.tileset?.tiles.find(
        (candidate) =>
          Math.abs(candidate.index.z) === failure.level &&
          candidate.index.x === failure.x &&
          candidate.index.y === failure.y,
      );
      if (!tile) continue;
      tile.setNeedsReload();
      layer.setNeedsUpdate();
    }
    changed();
  };

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
    get canvas() {
      return canvas;
    },
    get deck() {
      return deck;
    },
    gpu: { status: guard.status, stats: guard.stats, failure: () => failure },
    whenIdle,
    isSettled: settled,
    loadState: () => shown?.levels.loadState() ?? idleLoadState,
    failedTiles: () => shown?.levels.failures() ?? [],
    retryTile,
    decodeStats: () => shown?.reader?.stats() ?? null,
    residentTiles: () => countResidentTiles(deck),
    jpegReports: () => shown?.reader?.jpegReports() ?? [],
    sleep,
    setPrefetch: (enabled) => {
      prefetchOn = enabled;
      shown?.prefetcher?.setEnabled(enabled);
    },
    prefetchEnabled: () => prefetchOn,
    prefetchVector: () => shown?.prefetcher?.vector() ?? null,
    prefetchStats: () => shown?.reader?.prefetchStats() ?? null,
    showSlide,
    setCamera,
    setOverlays: (next) => {
      overlays = next;
      applyLayers();
    },
    setSlideBrightness: (factor) => {
      if (factor === brightness) return;
      brightness = factor;
      if (shown) shown = { ...shown, layer: slideLayer(shown) };
      applyLayers();
    },
    channels: () => shown?.channelLevels ?? null,
    setChannelDisplay: (display) => {
      channelDisplay = display;
      if (shown?.channelLevels) {
        shown = { ...shown, layer: slideLayer(shown) };
        applyLayers();
      }
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
      guard.destroy();
      stopObservingPixelRatio();
      disposeCurrentDeck();
      sleep?.destroy();
    },
  };
}

export function vivRendererFactory(options: VivRouteOptions = {}) {
  return (container: EngineContainer): VivRoute => createVivRoute(container, options);
}
