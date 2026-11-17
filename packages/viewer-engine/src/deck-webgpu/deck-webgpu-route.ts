import { Deck, type Layer, OrthographicView } from "@deck.gl/core";
import { TileLayer } from "@deck.gl/geo-layers";
import { BitmapLayer } from "@deck.gl/layers";
import type { Device, Texture } from "@luma.gl/core";
import { webgpuAdapter } from "@luma.gl/webgpu";
import { type Camera, originCamera } from "../camera/camera.ts";
import { defaultDecodeWorkers } from "../decode/decode-pool.ts";
import { rangeCacheFor } from "../decode/range-cache.ts";
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
import { absoluteUrl } from "../pixel-source/url.ts";
import { observeCanvasSize, observePixelRatio } from "../viv/canvas-observers.ts";
import { createDeckSleep, type DeckSleep } from "../viv/deck-sleep.ts";
import { disposeDeck } from "../viv/dispose-deck.ts";
import {
  defaultInterpolationRule,
  finestTileSampler,
  type InterpolationRule,
  usesNearestMagnification,
} from "../viv/interpolation.ts";
import type { PixelSlide } from "../viv/pixel-slide.ts";
import { createTileFade, installTileFade, tileFadeProp } from "../viv/tile-fade.ts";
import type { TileLoadState } from "../viv/tile-wait.ts";
import { createVivLevels, type VivLevels, vivSignalAborted } from "../viv/viv-levels.ts";
import {
  type WebGpuDeviceLike,
  WebGpuError,
  type WebGpuWatch,
  watchWebGpuDevice,
} from "../viv/webgpu-errors.ts";
import { splitByBufferLimit } from "./buffer-limit.ts";
import { webGpuPathType } from "./loop-data.ts";
import { rgbToRgba } from "./rgba.ts";
import { wgslDashExtensionFor } from "./wgsl-dash-extension.ts";

export const deckWebGpuViewId = "slide";

export const deckWebGpuTileRequests = 10;

const idleLoadState: TileLoadState = { pending: 0, waitingMs: 0, answerMs: null };

const idleFramesRequired = 2;

const overlayImageProps = ["image", "iconAtlas"] as const;

const linearTileSampler = {
  minFilter: "linear",
  magFilter: "linear",
  addressModeU: "clamp-to-edge",
  addressModeV: "clamp-to-edge",
} as const;

const defaultOverlaySampler: {
  minFilter: "linear" | "nearest";
  magFilter: "linear" | "nearest";
  mipmapFilter: "linear" | "nearest" | "none";
  addressModeU: "clamp-to-edge";
  addressModeV: "clamp-to-edge";
} = { ...linearTileSampler, mipmapFilter: "linear" };

export class DeckWebGpuUnsupportedOverlayError extends Error {
  constructor(what: string) {
    super(`The deck.gl WebGPU route cannot draw every overlay style: ${what}`);
    this.name = "DeckWebGpuUnsupportedOverlayError";
  }
}

export class UnsupportedDeckWebGpuSourceError extends Error {
  constructor(reason: string) {
    super(`The deck.gl WebGPU route draws 8-bit RGB slides only: ${reason}`);
    this.name = "UnsupportedDeckWebGpuSourceError";
  }
}

export interface DeckWebGpuRouteOptions {
  readonly onError?: (error: Error) => void;
  readonly onTileError?: (error: Error) => void;
  readonly tileFade?: { readonly durationMs?: number; readonly now?: () => number };
  readonly useDevicePixels?: boolean | number;
  readonly decodeWorkers?: number;
  readonly spawnDecodeWorker?: (index: number) => DecodeWorker;
  readonly sleepWhenIdle?: boolean;
  readonly interpolation?: InterpolationRule;
}

export interface DeckWebGpuRoute extends RendererRoute<PixelSlide> {
  readonly canvas: HTMLCanvasElement;
  readonly deck: Deck<OrthographicView>;
  readonly isSettled: () => boolean;
  readonly loadState: () => TileLoadState;
  readonly decodeStats: () => DecodeStats | null;
  readonly uncapturedGpuErrors: () => number;
  readonly failure: () => Error | null;
  readonly sleep: DeckSleep | null;
}

interface TileContent {
  readonly texture: Texture;
  readonly width: number;
  readonly height: number;
}

interface Shown {
  readonly slide: PixelSlide;
  readonly levels: VivLevels;
  readonly reader: WorkerRegionReader | null;
  readonly textures: Set<Texture>;
  readonly layer: Layer;
}

interface TileIndex {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

interface SubLayerProps {
  readonly data: TileContent | null;
  readonly tile: {
    readonly index: TileIndex;
    readonly bbox: { readonly left: number; readonly top: number };
  };
}

interface FrameLoopHandle {
  setProps(props: { animationFrameProvider: DeckSleep["provider"] }): unknown;
  readonly props?: { readonly device?: unknown };
}

interface GpuQueueLike {
  onSubmittedWorkDone(): Promise<unknown>;
}

function frameLoop(deck: Deck<OrthographicView>): FrameLoopHandle | null {
  return (deck as unknown as { animationLoop?: FrameLoopHandle | null }).animationLoop ?? null;
}

function viewState(camera: Camera) {
  return { target: [camera.x, camera.y, 0] as [number, number, number], zoom: camera.zoom };
}

function hostElement(container: EngineContainer): HTMLElement {
  if (typeof HTMLElement === "undefined" || !(container instanceof HTMLElement)) {
    throw new Error("The deck.gl WebGPU route needs an HTML element to mount on");
  }
  return container;
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export function createDeckWebGpuRoute(
  container: EngineContainer,
  options: DeckWebGpuRouteOptions = {},
): DeckWebGpuRoute {
  const host = hostElement(container);
  installTileFade(BitmapLayer);
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

  const canvas = document.createElement("canvas");
  canvas.style.cssText = "display:block;width:100%;height:100%";
  host.append(canvas);

  let camera = originCamera;
  let shown: Shown | null = null;
  let overlays: readonly OverlayLayer[] = [];
  let overlayLayers: Layer[] = [];
  let overlayLod = "";
  let brightness = 1;
  const overlayBuilder = createOverlayLayerBuilder();
  const reportedLimits = new Set<string>();
  let overlayTextures = new Map<ImageData, Texture>();
  let extensionsReported = false;
  let changes = 0;
  let renderedChanges = -1;
  let destroyed = false;
  let failure: Error | null = null;
  let device: Device | null = null;
  let watch: WebGpuWatch | null = null;

  const fail = (error: Error) => {
    if (destroyed || failure !== null) return;
    failure = error;
    sleep?.wake("change");
    reportError(error);
  };

  const usable = () => !destroyed && failure === null;

  const deviceReady = (created: Device) => {
    if (destroyed) return;
    device = created;
    const handle = (created as unknown as { handle?: WebGpuDeviceLike }).handle;
    if (handle) {
      watch = watchWebGpuDevice(handle, {
        onError: (error) => {
          if (error.source === "device-lost") fail(error);
          else reportError(error);
        },
      });
    }
    applyLayers();
  };

  const deck: Deck<OrthographicView> = new Deck<OrthographicView>({
    canvas,
    views: new OrthographicView({ id: deckWebGpuViewId, controller: false }),
    controller: false,
    getCursor: () => "inherit",
    viewState: viewState(camera),
    layers: [],
    useDevicePixels: options.useDevicePixels ?? true,
    deviceProps: { type: "webgpu", adapters: [webgpuAdapter], featureLevel: "max" } as never,
    onDeviceInitialized: deviceReady,
    onError: (error) => {
      if (!usable()) return;
      reportError(error);
    },
    onAfterRender: () => {
      renderedChanges = changes;
    },
  });

  const pendingDevice = frameLoop(deck)?.props?.device;
  if (pendingDevice instanceof Promise) {
    pendingDevice.then(
      (created: Device | null) => {
        if (destroyed) created?.destroy();
      },
      (error: unknown) => {
        fail(
          new WebGpuError("device-lost", `No WebGPU device was created: ${asError(error).message}`),
        );
      },
    );
  }

  const workerCount = options.decodeWorkers ?? defaultDecodeWorkers;

  const readerFor = (slide: PixelSlide): WorkerRegionReader | null => {
    const opened = slide.opened;
    if (opened === null || workerCount < 1) return null;
    const reported = new Set<unknown>();
    const reportOnce = (error: unknown) => {
      if (reported.has(error)) return;
      reported.add(error);
      reportError(asError(error));
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
      cache: slide.bytes ?? rangeCacheFor(opened),
      ...(options.spawnDecodeWorker ? { spawn: options.spawnDecodeWorker } : {}),
    });
    reader.ready.catch(reportOnce);
    reader.setFocus({ x: camera.x, y: camera.y });
    return reader;
  };

  const release = (current: Shown | null) => {
    if (current === null) return;
    current.reader?.dispose();
    for (const texture of current.textures) texture.destroy();
    current.textures.clear();
  };

  const changed = () => {
    changes++;
    if (usable() && !documentVisibility.hidden()) deck.redraw("parfocal route change");
    sleep?.wake("change");
  };

  const viewRect = (): ViewRect | undefined =>
    cameraViewRect(camera, canvas.clientWidth, canvas.clientHeight);

  const overlayDetailMoved = (): boolean =>
    overlayBuilder.lodKey(overlays, 2 ** camera.zoom, viewRect()) !== overlayLod;

  const withinBufferLimit = (layers: Layer[]): Layer[] => {
    const limit = (device as unknown as { limits?: { maxBufferSize?: number } } | null)?.limits
      ?.maxBufferSize;
    if (limit === undefined) return layers;
    const { drawable, rejected } = splitByBufferLimit(layers, limit);
    for (const error of rejected) {
      const key = `${error.layerId}/${error.bytes}`;
      if (reportedLimits.has(key)) continue;
      reportedLimits.add(key);
      reportError(error);
    }
    return drawable;
  };

  const overlayTexture = (current: Device, image: ImageData, parameters: unknown): Texture => {
    const sampler = {
      ...defaultOverlaySampler,
      ...(parameters as Partial<typeof defaultOverlaySampler> | null),
    };
    const mipmapped = sampler.mipmapFilter !== "none";
    const texture = current.createTexture({
      width: image.width,
      height: image.height,
      dimension: "2d",
      format: "rgba8unorm",
      mipLevels: mipmapped ? current.getMipLevelCount(image.width, image.height) : 1,
      sampler,
    });
    texture.writeData(
      new Uint8Array(image.data.buffer, image.data.byteOffset, image.data.byteLength),
    );
    if (mipmapped) current.generateMipmapsWebGPU(texture);
    return texture;
  };

  const withOwnedTextures = (layers: Layer[]): Layer[] => {
    const current = device;
    if (current === null) return [];
    const next = new Map<ImageData, Texture>();
    const owned = layers.map((layer): Layer => {
      const props = layer.props as unknown as Record<string, unknown>;
      const replaced: Record<string, unknown> = {};
      for (const name of overlayImageProps) {
        const image = props[name];
        if (!(image instanceof ImageData)) continue;
        const texture =
          next.get(image) ??
          overlayTextures.get(image) ??
          overlayTexture(current, image, props["textureParameters"]);
        next.set(image, texture);
        replaced[name] = texture;
      }
      const extensions = props["extensions"];
      if (Array.isArray(extensions) && extensions.length > 0) {
        const drawable = extensions.map(wgslDashExtensionFor).filter((entry) => entry !== null);
        replaced["extensions"] = drawable;
        if (drawable.length < extensions.length && !extensionsReported) {
          extensionsReported = true;
          reportError(
            new DeckWebGpuUnsupportedOverlayError("a layer extension without WGSL is left out"),
          );
        }
      }
      const pathType = webGpuPathType(props["_pathType"], props["data"]);
      if (pathType !== null) replaced["_pathType"] = pathType;
      return Object.keys(replaced).length === 0 ? layer : (layer.clone(replaced) as Layer);
    });
    for (const [image, texture] of overlayTextures) {
      if (!next.has(image)) texture.destroy();
    }
    overlayTextures = next;
    return owned;
  };

  const applyLayers = () => {
    if (!usable()) return;
    const pixelsPerUnit = 2 ** camera.zoom;
    const rect = viewRect();
    overlayLod = overlayBuilder.lodKey(overlays, pixelsPerUnit, rect);
    overlayLayers = withOwnedTextures(
      withinBufferLimit(overlayBuilder.build(overlays, pixelsPerUnit, rect)),
    );
    deck.setProps({ layers: shown ? [shown.layer, ...overlayLayers] : [] });
    changed();
  };

  const tileTexture = (
    data: Uint8Array,
    width: number,
    height: number,
    level: number,
  ): Texture | null => {
    if (device === null) return null;
    const texture = device.createTexture({
      width,
      height,
      dimension: "2d",
      format: "rgba8unorm",
      mipLevels: 1,
      sampler: usesNearestMagnification(interpolationRule, level)
        ? finestTileSampler
        : linearTileSampler,
    });
    texture.writeData(rgbToRgba(data, width, height));
    return texture;
  };

  const slideLayer = (current: Pick<Shown, "slide" | "levels" | "textures">): Layer => {
    const { levels, textures } = current;
    const [finest] = levels.ladder;
    const tint = slideTint(brightness);
    return new TileLayer<TileContent | null>({
      id: `slide-${current.slide.id}`,
      pickable: false,
      tileSize: levels.tileSize,
      extent: [0, 0, finest?.width ?? 0, finest?.height ?? 0],
      minZoom: -(levels.levels.length - 1),
      maxZoom: 0,
      maxRequests: deckWebGpuTileRequests,
      refinementStrategy: "best-available",
      updateTriggers: { renderSubLayers: [brightness] },
      getTileData: async ({ index, signal }) => {
        const level = levels.levels[Math.round(-index.z)];
        if (level === undefined) return null;
        try {
          const tile = await level.getTile({
            x: index.x,
            y: index.y,
            ...(signal ? { signal } : {}),
          });
          if (signal?.aborted || destroyed || shown?.textures !== textures) return null;
          if (tile.width === 0 || tile.height === 0) return null;
          const texture = tileTexture(tile.data, tile.width, tile.height, index.z);
          if (texture === null) return null;
          textures.add(texture);
          return { texture, width: tile.width, height: tile.height };
        } catch (error) {
          if (error === vivSignalAborted) return null;
          throw error;
        }
      },
      onTileUnload: (tile) => {
        const content = tile.content;
        if (!content) return;
        textures.delete(content.texture);
        content.texture.destroy();
      },
      onTileError: (error) => {
        (options.onTileError ?? reportError)(asError(error));
      },
      renderSubLayers: (props) => {
        const { data, tile } = props as unknown as SubLayerProps;
        const { left, top } = tile.bbox;
        if (!data || left < 0 || top < 0) return null;
        const scale = 2 ** Math.round(-tile.index.z);
        return new BitmapLayer(
          props as never,
          {
            data: undefined,
            image: data.texture,
            bounds: [left, top + data.height * scale, left + data.width * scale, top],
            tintColor: tint,
            tileId: tile.index,
            [tileFadeProp]: tileFade,
            pickable: false,
          } as never,
        );
      },
    });
  };

  const showSlide = (slide: PixelSlide | null) => {
    if (failure !== null || slide === shown?.slide) return;
    const previous = shown;
    shown = null;
    if (slide === null) {
      applyLayers();
      release(previous);
      return;
    }
    if (slide.source.photometric !== "rgb" || slide.source.dtype !== "uint8") {
      applyLayers();
      release(previous);
      throw new UnsupportedDeckWebGpuSourceError(
        `this slide is ${slide.source.photometric} with ${slide.source.dtype} samples`,
      );
    }
    const reader = readerFor(slide);
    try {
      shown = disposingOnThrow(reader, () => {
        const levels = createVivLevels(slide.source, {
          onTileError: options.onTileError ?? reportError,
          onReadSettled: () => sleep?.wake("read"),
          ...(reader ? { read: reader.read } : {}),
        });
        const base = { slide, levels, reader, textures: new Set<Texture>() };
        return { ...base, layer: slideLayer(base) };
      });
    } finally {
      applyLayers();
      release(previous);
    }
  };

  const setCamera = (next: Camera) => {
    camera = next;
    shown?.reader?.setFocus({ x: camera.x, y: camera.y });
    if (usable()) deck.setProps({ viewState: viewState(camera) });
    if (overlayDetailMoved() && usable()) applyLayers();
    else changed();
  };

  const resized = () => {
    sleep?.wake("resize");
    if (overlayDetailMoved()) applyLayers();
  };

  let fadeWasActive = false;

  const settled = (): boolean => {
    if (failure !== null) return true;
    if (destroyed || device === null) return false;
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
  if (sleep) frameLoop(deck)?.setProps({ animationFrameProvider: sleep.provider });
  const stopObservingCanvas = observeCanvasSize(canvas, resized);
  const stopObservingPixelRatio = observePixelRatio(() => sleep?.wake("resize"));

  const submittedWorkDone = async (): Promise<void> => {
    const queue = (device as unknown as { handle?: { queue?: GpuQueueLike } } | null)?.handle
      ?.queue;
    await queue?.onSubmittedWorkDone();
  };

  const whenIdle = (signal?: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      let calm = 0;
      const check = () => {
        if (destroyed) {
          reject(new Error("The deck.gl WebGPU route was destroyed before it settled"));
          return;
        }
        if (signal?.aborted) {
          reject(
            new Error("Waiting for the deck.gl WebGPU route was aborted", {
              cause: signal.reason,
            }),
          );
          return;
        }
        if (failure !== null) {
          reject(failure);
          return;
        }
        const isSettled = settled();
        if (!isSettled) sleep?.wake("poll");
        calm = isSettled ? calm + 1 : 0;
        if (calm >= idleFramesRequired) {
          submittedWorkDone().then(resolve, (error: unknown) => {
            reject(asError(error));
          });
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
    loadState: () => shown?.levels.loadState() ?? idleLoadState,
    decodeStats: () => shown?.reader?.stats() ?? null,
    uncapturedGpuErrors: () => watch?.uncaptured() ?? 0,
    failure: () => failure,
    sleep,
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
    invalidateOverlay: (id) => {
      if (!overlays.some((overlay) => overlay.id === id)) return;
      overlayBuilder.invalidate(id);
      applyLayers();
    },
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      const previous = shown;
      shown = null;
      release(previous);
      for (const texture of overlayTextures.values()) texture.destroy();
      overlayTextures.clear();
      watch?.stop();
      stopObservingCanvas();
      stopObservingPixelRatio();
      disposeDeck(deck as unknown as Deck, canvas);
      device?.destroy();
      sleep?.destroy();
    },
  };
}

export function deckWebGpuRendererFactory(options: DeckWebGpuRouteOptions = {}) {
  return (container: EngineContainer): DeckWebGpuRoute => createDeckWebGpuRoute(container, options);
}
