import { originCamera } from "../camera/camera.ts";
import { WebGpuBufferLimitError } from "../deck-webgpu/buffer-limit.ts";
import { rgbToRgba } from "../deck-webgpu/rgba.ts";
import { defaultDecodeWorkers } from "../decode/decode-pool.ts";
import { createRangeCache } from "../decode/range-cache.ts";
import {
  createWorkerRegionReader,
  type DecodeStats,
  type DecodeWorker,
  disposingOnThrow,
  type WorkerRegionReader,
} from "../decode/worker-reader.ts";
import { systemClock } from "../engine/environment.ts";
import type { EngineContainer, OverlayLayer, RendererRoute } from "../engine/types.ts";
import { cameraViewRect } from "../overlay/cull-grid.ts";
import { nearBlack, white } from "../overlay/outline-style.ts";
import {
  isLabelOverlay,
  isOverlayDescription,
  isPinOverlay,
  isRasterOverlay,
} from "../overlay/overlay.ts";
import { createPinAtlas } from "../overlay/pin-icons.ts";
import type {
  LabelOverlay,
  OverlayDescription,
  PinOverlay,
  RasterOverlay,
  ShapeData,
  VectorOverlay,
} from "../overlay/types.ts";
import { absoluteUrl } from "../pixel-source/url.ts";
import { observeCanvasSize, observePixelRatio } from "../viv/canvas-observers.ts";
import { defaultLossWindowMs, defaultMaxLossesInWindow } from "../viv/gpu-recovery.ts";
import { defaultInterpolationRule, type InterpolationRule } from "../viv/interpolation.ts";
import type { PixelSlide } from "../viv/pixel-slide.ts";
import { createTileFade } from "../viv/tile-fade.ts";
import type { TileLoadState } from "../viv/tile-wait.ts";
import { createVivLevels, type VivLevels, vivSignalAborted } from "../viv/viv-levels.ts";
import { WebGpuError } from "../viv/webgpu-errors.ts";
import {
  type CulledSet,
  type CulledShapes,
  culledDraw,
  culledSet,
  cullShapes,
} from "./culled-sets.ts";
import { buildLabelInstances, createGlyphAtlas, type GlyphLayout } from "./label-glyphs.ts";
import {
  type LayerDraw,
  type RenderRequest,
  type RenderResponse,
  renderWorkerName,
  type SetDraw,
} from "./protocol.ts";
import {
  atlasLayersFor,
  magnifiesFinestLevel,
  type PlacedTile,
  parentTile,
  type TileAddress,
  tileInstances,
  tileKey,
  tileLevelFor,
  type ViewSize,
  visibleTiles,
} from "./tile-selection.ts";
import { buildVectorInstances } from "./vector-instances.ts";

export const customWebGpuTileRequests = 10;

const idleLoadState: TileLoadState = { pending: 0, waitingMs: 0, answerMs: null };

const idleFramesRequired = 3;

const fadeGamma = 2.2;

const opacityGamma = 2.2;

export const customWebGpuPinSizePx = 28;

const pinInstanceFloats = 3;

const labelBorderPx = 2;

function glyphSetId(id: string): string {
  return `${id}:glyphs`;
}

function dotsSetId(id: string): string {
  return `${id}:dots`;
}

function densityRasterId(id: string): string {
  return `${id}:density`;
}

const vectorKinds: ReadonlySet<string> = new Set([
  "human-annotations",
  "ai-proposals",
  "nuclei",
  "measurements",
]);

export class CustomWebGpuUnsupportedOverlayError extends Error {
  constructor(what: string) {
    super(`The custom WebGPU route cannot draw every overlay: ${what}`);
    this.name = "CustomWebGpuUnsupportedOverlayError";
  }
}

export class UnsupportedCustomWebGpuSourceError extends Error {
  constructor(reason: string) {
    super(`The custom WebGPU route draws 8-bit RGB slides only: ${reason}`);
    this.name = "UnsupportedCustomWebGpuSourceError";
  }
}

export interface RenderWorkerLike {
  postMessage(message: RenderRequest, transfer: Transferable[]): void;
  addEventListener(type: "message", listener: (event: MessageEvent<RenderResponse>) => void): void;
  addEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  terminate(): void;
}

export interface CustomWebGpuRouteOptions {
  readonly onError?: (error: Error) => void;
  readonly onTileError?: (error: Error) => void;
  readonly tileFade?: { readonly durationMs?: number; readonly now?: () => number };
  readonly useDevicePixels?: boolean | number;
  readonly decodeWorkers?: number;
  readonly spawnDecodeWorker?: (index: number) => DecodeWorker;
  readonly spawnRenderWorker?: () => RenderWorkerLike;
  readonly interpolation?: InterpolationRule;
  readonly gpuTiming?: boolean;
}

export interface CustomWebGpuRoute extends RendererRoute<PixelSlide> {
  readonly canvas: HTMLCanvasElement;
  readonly isSettled: () => boolean;
  readonly loadState: () => TileLoadState;
  readonly decodeStats: () => DecodeStats | null;
  readonly uncapturedGpuErrors: () => number;
  readonly overlayBufferWrites: () => number;
  readonly failure: () => Error | null;
  readonly deviceRecoveries: () => number;
  readonly loseDevice: () => void;
  readonly redraw: () => void;
  readonly takeGpuTimes: () => number[];
}

interface TileEntry {
  readonly address: TileAddress;
  readonly controller: AbortController;
  state: "loading" | "ready" | "failed";
  layer: number;
  width: number;
  height: number;
  used: number;
}

interface Shown {
  readonly slide: PixelSlide;
  readonly levels: VivLevels;
  readonly reader: WorkerRegionReader | null;
  readonly tiles: Map<string, TileEntry>;
}

interface Atlas {
  readonly tileSize: number;
  readonly layers: number;
  readonly free: number[];
}

interface SentLayer {
  readonly source: object;
  readonly dashed: boolean;
}

export function spawnRenderWorker(): RenderWorkerLike {
  return new Worker(new URL("../workers/render.worker.ts", import.meta.url), {
    type: "module",
    name: renderWorkerName,
  });
}

function hostElement(container: EngineContainer): HTMLElement {
  if (typeof HTMLElement === "undefined" || !(container instanceof HTMLElement)) {
    throw new Error("The custom WebGPU route needs an HTML element to mount on");
  }
  return container;
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function isVector(overlay: OverlayDescription): overlay is VectorOverlay {
  return vectorKinds.has(overlay.kind);
}

function layerAlpha(opacity: number): number {
  return Math.max(0, opacity) ** (1 / opacityGamma);
}

function setDraw(overlay: VectorOverlay): SetDraw {
  const { style, opacity } = overlay;
  return {
    kind: "set",
    id: overlay.id,
    fillAlpha: style.fillOpacity > 0 ? layerAlpha(opacity * style.fillOpacity) : 0,
    alpha: layerAlpha(opacity),
    lineWidthPx: style.lineWidthPx,
    lineColor: style.lineColor,
    casing: style.casing
      ? {
          widthPx: style.casing.widthPx,
          color: style.casing.color,
          followsAlpha: style.casing.followsAlpha === true,
        }
      : null,
    dash: style.dash,
    pointRadiusPx: style.pointRadiusPx,
  };
}

export function createCustomWebGpuRoute(
  container: EngineContainer,
  options: CustomWebGpuRouteOptions = {},
): CustomWebGpuRoute {
  const host = hostElement(container);
  const now = options.tileFade?.now ?? systemClock;
  const tileFade = createTileFade(now, options.tileFade?.durationMs);
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
  let atlas: Atlas | null = null;
  let maxLayers: number | null = null;
  let overlays: readonly OverlayLayer[] = [];
  const sentLayers = new Map<string, SentLayer>();
  const culled = new Map<string, CulledSet>();
  const culledShapes = new WeakMap<ShapeData, CulledShapes | null>();
  const reportedOverlays = new Set<string>();
  let overlayWrites = 0;
  let pinAtlasSent = false;
  let glyphLayout: GlyphLayout | null = null;
  let brightness = 1;
  let loading = 0;
  let frameCounter = 0;
  let sentFrame = 0;
  let drawnFrame = 0;
  let dirty = false;
  let frameHandle: number | null = null;
  let destroyed = false;
  let failure: Error | null = null;
  let uncaptured = 0;
  let recoveries = 0;
  let gpuTimes: number[] = [];
  let awaitingLoss = false;
  let recentLosses: number[] = [];

  const worker = (options.spawnRenderWorker ?? spawnRenderWorker)();
  const post = (message: RenderRequest, transfer: Transferable[] = []) => {
    if (!destroyed) worker.postMessage(message, transfer);
  };

  const usable = () => !destroyed && failure === null;

  const fail = (error: Error) => {
    if (destroyed || failure !== null) return;
    failure = error;
    reportError(error);
  };

  const pixelRatio = (): number => {
    const wanted = options.useDevicePixels ?? true;
    if (typeof wanted === "number") return wanted;
    return wanted ? devicePixelRatio : 1;
  };

  const viewSize = (): ViewSize => ({ width: canvas.clientWidth, height: canvas.clientHeight });

  const sendSize = () => {
    const view = viewSize();
    const ratio = pixelRatio();
    post({
      type: "resize",
      width: Math.round(view.width * ratio),
      height: Math.round(view.height * ratio),
    });
  };

  const changed = () => {
    dirty = true;
    if (frameHandle !== null || !usable()) return;
    frameHandle = requestAnimationFrame(() => {
      frameHandle = null;
      sendFrame();
    });
  };

  const dropTiles = (current: Shown) => {
    for (const entry of current.tiles.values()) entry.controller.abort();
    current.tiles.clear();
  };

  const ensureAtlas = (current: Shown, view: ViewSize): Atlas | null => {
    if (maxLayers === null) return null;
    const { tileSize } = current.levels;
    const layers = atlasLayersFor(view, tileSize, maxLayers);
    if (atlas !== null && atlas.tileSize === tileSize && atlas.layers >= layers) return atlas;
    dropTiles(current);
    atlas = { tileSize, layers, free: Array.from({ length: layers }, (_, layer) => layer) };
    post({ type: "atlas", tileSize, layers });
    return atlas;
  };

  const takeLayer = (current: Shown, target: Atlas): number | null => {
    const free = target.free.pop();
    if (free !== undefined) return free;
    let oldest: [string, TileEntry] | null = null;
    for (const candidate of current.tiles) {
      const entry = candidate[1];
      if (entry.state !== "ready" || entry.used >= frameCounter) continue;
      if (oldest === null || entry.used < oldest[1].used) oldest = candidate;
    }
    if (oldest === null) return null;
    current.tiles.delete(oldest[0]);
    return oldest[1].layer;
  };

  const load = (current: Shown, address: TileAddress) => {
    const level = current.levels.levels[address.level];
    if (level === undefined) return;
    const key = tileKey(address);
    const entry: TileEntry = {
      address,
      controller: new AbortController(),
      state: "loading",
      layer: -1,
      width: 0,
      height: 0,
      used: frameCounter,
    };
    current.tiles.set(key, entry);
    loading += 1;
    const stillWanted = () =>
      !destroyed &&
      shown === current &&
      current.tiles.get(key) === entry &&
      !entry.controller.signal.aborted;
    level.getTile({ x: address.x, y: address.y, signal: entry.controller.signal }).then(
      (tile) => {
        loading -= 1;
        const target = atlas;
        if (!stillWanted() || target === null) {
          if (current.tiles.get(key) === entry) current.tiles.delete(key);
          changed();
          return;
        }
        const layer = tile.width === 0 || tile.height === 0 ? null : takeLayer(current, target);
        if (layer === null) {
          entry.state = "failed";
          changed();
          return;
        }
        const rgba = rgbToRgba(tile.data, tile.width, tile.height);
        post({ type: "tile", layer, width: tile.width, height: tile.height, rgba: rgba.buffer }, [
          rgba.buffer,
        ]);
        entry.layer = layer;
        entry.width = tile.width;
        entry.height = tile.height;
        entry.state = "ready";
        changed();
      },
      (error: unknown) => {
        loading -= 1;
        if (error === vivSignalAborted || !stillWanted()) {
          if (current.tiles.get(key) === entry) current.tiles.delete(key);
        } else {
          entry.state = "failed";
          (options.onTileError ?? reportError)(asError(error));
        }
        changed();
      },
    );
  };

  const placeTiles = (current: Shown, view: ViewSize): PlacedTile[] => {
    const target = ensureAtlas(current, view);
    if (target === null) return [];
    const { ladder, tileSize } = current.levels;
    const selected = visibleTiles(camera, view, ladder, tileSize);
    const wanted = new Set(selected.map(tileKey));
    for (const [key, entry] of current.tiles) {
      if (entry.state !== "loading" || wanted.has(key)) continue;
      entry.controller.abort();
      current.tiles.delete(key);
    }
    const sharp: PlacedTile[] = [];
    const standIns = new Map<string, PlacedTile>();
    for (const address of selected) {
      const entry = current.tiles.get(tileKey(address));
      if (entry === undefined) {
        if (loading < customWebGpuTileRequests) load(current, address);
      } else {
        entry.used = frameCounter;
      }
      if (entry?.state === "ready") {
        sharp.push({
          tile: address,
          layer: entry.layer,
          width: entry.width,
          height: entry.height,
          alpha: tileFade.opacityOf(entry) ** fadeGamma,
        });
        continue;
      }
      if (entry?.state === "failed") continue;
      for (
        let parent = parentTile(address, ladder.length);
        parent !== null;
        parent = parentTile(parent, ladder.length)
      ) {
        const key = tileKey(parent);
        const ancestor = current.tiles.get(key);
        if (ancestor?.state !== "ready") continue;
        ancestor.used = frameCounter;
        standIns.set(key, {
          tile: parent,
          layer: ancestor.layer,
          width: ancestor.width,
          height: ancestor.height,
          alpha: 1,
        });
        break;
      }
    }
    const below = [...standIns.values()].sort((a, b) => b.tile.level - a.tile.level);
    return [...below, ...sharp];
  };

  const reportLeftOut = (id: string, bytes: number, limit: number) => {
    if (reportedOverlays.has(id)) return;
    reportedOverlays.add(id);
    reportError(new WebGpuBufferLimitError(id, bytes, limit));
  };

  const dropDerived = (id: string) => {
    post({ type: "drop", id: dotsSetId(id) });
    post({ type: "drop", id: densityRasterId(id) });
  };

  const preparedShapes = (shapes: ShapeData): CulledShapes | null => {
    const known = culledShapes.get(shapes);
    if (known !== undefined) return known;
    const prepared = cullShapes(shapes);
    culledShapes.set(shapes, prepared);
    return prepared;
  };

  const sendSet = (overlay: VectorOverlay) => {
    const dashed = overlay.style.dash !== null;
    const options = { ringsFromMidFirstEdge: dashed };
    const prepared = preparedShapes(overlay.shapes);
    const { data, counts } = buildVectorInstances(prepared?.shapes ?? overlay.shapes, options);
    sentLayers.set(overlay.id, { source: overlay.shapes, dashed });
    overlayWrites += 1;
    post({ type: "set", id: overlay.id, data, counts }, [data]);
    if (prepared === null) {
      if (culled.delete(overlay.id)) dropDerived(overlay.id);
      return;
    }
    culled.set(overlay.id, culledSet(prepared, counts, options));
    const dots = buildVectorInstances({ points: prepared.centres });
    overlayWrites += 1;
    post({ type: "set", id: dotsSetId(overlay.id), data: dots.data, counts: dots.counts }, [
      dots.data,
    ]);
    if (prepared.density === null) return;
    const { width, height, rgba } = prepared.density;
    const copy = new Uint8Array(rgba.byteLength);
    copy.set(rgba);
    post(
      {
        type: "raster",
        id: densityRasterId(overlay.id),
        width,
        height,
        rgba: copy.buffer,
        smooth: true,
      },
      [copy.buffer],
    );
  };

  const vectorDraws = (overlay: VectorOverlay): LayerDraw[] => {
    const base = setDraw(overlay);
    const set = culled.get(overlay.id);
    if (set === undefined) return [base];
    const view = viewSize();
    const { choice, ranges, dots } = culledDraw(
      set,
      2 ** camera.zoom,
      cameraViewRect(camera, view.width, view.height),
    );
    const draws: LayerDraw[] = [];
    if (choice.tier === "density" && set.density !== null) {
      draws.push({
        kind: "raster",
        id: densityRasterId(overlay.id),
        alpha: layerAlpha(overlay.opacity),
        area: set.density.area,
      });
    }
    if (dots !== null) {
      draws.push({
        ...base,
        id: dotsSetId(overlay.id),
        fillAlpha: 0,
        lineWidthPx: 0,
        casing: null,
        dash: null,
        pointRadiusPx: choice.dotRadiusPx,
        ranges: { points: dots },
      });
    }
    draws.push({ ...base, ranges });
    return draws;
  };

  const sendRaster = (overlay: RasterOverlay) => {
    const { width, height, rgba, smooth } = overlay.raster;
    const copy = new Uint8Array(rgba.byteLength);
    copy.set(rgba);
    sentLayers.set(overlay.id, { source: overlay.raster, dashed: false });
    post({ type: "raster", id: overlay.id, width, height, rgba: copy.buffer, smooth }, [
      copy.buffer,
    ]);
  };

  const sendPins = (overlay: PinOverlay) => {
    if (!pinAtlasSent) {
      pinAtlasSent = true;
      const atlasImage = createPinAtlas();
      const { open, resolved } = atlasImage.mapping;
      const rgba = new Uint8Array(atlasImage.rgba);
      post(
        {
          type: "pinAtlas",
          width: atlasImage.width,
          height: atlasImage.height,
          rgba: rgba.buffer,
          frames: {
            width: open.width,
            height: open.height,
            anchorX: open.anchorX,
            anchorY: open.anchorY,
            openX: open.x,
            resolvedX: resolved.x,
            y: open.y,
          },
        },
        [rgba.buffer],
      );
    }
    const { count, positions, resolved } = overlay.pins;
    const data = new Float32Array(count * pinInstanceFloats);
    let cursor = 0;
    for (const state of [0, 1]) {
      for (let pin = 0; pin < count; pin++) {
        if ((resolved[pin] ?? 0) !== state) continue;
        data[cursor] = positions[pin * 2] ?? 0;
        data[cursor + 1] = positions[pin * 2 + 1] ?? 0;
        data[cursor + 2] = state;
        cursor += pinInstanceFloats;
      }
    }
    sentLayers.set(overlay.id, { source: overlay.pins, dashed: false });
    overlayWrites += 1;
    post(
      {
        type: "set",
        id: overlay.id,
        data: data.buffer,
        counts: { triangles: 0, segments: 0, points: cursor / pinInstanceFloats },
      },
      [data.buffer],
    );
  };

  const sendLabels = (overlay: LabelOverlay) => {
    if (glyphLayout === null) {
      const { rgba, ...layout } = createGlyphAtlas();
      glyphLayout = layout;
      post({ type: "glyphAtlas", width: layout.width, height: layout.height, rgba: rgba.buffer }, [
        rgba.buffer,
      ]);
    }
    const { boxes, boxCount, glyphs, glyphCount } = buildLabelInstances(
      overlay.labels,
      glyphLayout,
    );
    sentLayers.set(overlay.id, { source: overlay.labels, dashed: false });
    overlayWrites += 2;
    post(
      {
        type: "set",
        id: overlay.id,
        data: boxes,
        counts: { triangles: 0, segments: 0, points: boxCount },
      },
      [boxes],
    );
    post(
      {
        type: "set",
        id: glyphSetId(overlay.id),
        data: glyphs,
        counts: { triangles: 0, segments: 0, points: glyphCount },
      },
      [glyphs],
    );
  };

  const syncOverlays = (force: string | null) => {
    const kept = new Set<string>();
    for (const layer of overlays) {
      if (!isOverlayDescription(layer)) continue;
      const sent = sentLayers.get(layer.id);
      if (isVector(layer)) {
        kept.add(layer.id);
        const dashed = layer.style.dash !== null;
        if (force === layer.id || sent?.source !== layer.shapes || sent.dashed !== dashed) {
          sendSet(layer);
        }
      } else if (isRasterOverlay(layer)) {
        kept.add(layer.id);
        if (force === layer.id || sent?.source !== layer.raster) sendRaster(layer);
      } else if (isPinOverlay(layer)) {
        kept.add(layer.id);
        if (force === layer.id || sent?.source !== layer.pins) sendPins(layer);
      } else if (isLabelOverlay(layer)) {
        kept.add(layer.id);
        if (force === layer.id || sent?.source !== layer.labels) sendLabels(layer);
      }
    }
    for (const id of [...sentLayers.keys()]) {
      if (kept.has(id)) continue;
      sentLayers.delete(id);
      post({ type: "drop", id });
      post({ type: "drop", id: glyphSetId(id) });
      if (culled.delete(id)) dropDerived(id);
    }
  };

  const drawnLayers = (): LayerDraw[] =>
    overlays
      .filter(isOverlayDescription)
      .filter((overlay) => overlay.visible && sentLayers.has(overlay.id))
      .sort((a, b) => a.order - b.order)
      .flatMap((overlay): LayerDraw[] => {
        if (isVector(overlay)) return vectorDraws(overlay);
        if (isRasterOverlay(overlay)) {
          return [
            {
              kind: "raster",
              id: overlay.id,
              alpha: layerAlpha(overlay.opacity),
              area: overlay.raster.area,
            },
          ];
        }
        if (isPinOverlay(overlay)) {
          return [
            {
              kind: "pins",
              id: overlay.id,
              alpha: layerAlpha(overlay.opacity),
              sizePx: customWebGpuPinSizePx,
            },
          ];
        }
        if (isLabelOverlay(overlay)) {
          return [
            {
              kind: "labels",
              id: overlay.id,
              glyphsId: glyphSetId(overlay.id),
              alpha: layerAlpha(overlay.opacity),
              fill: nearBlack,
              text: white,
              borderPx: labelBorderPx,
            },
          ];
        }
        return [];
      });

  const sendFrame = () => {
    if (!usable()) return;
    dirty = false;
    frameCounter += 1;
    const view = viewSize();
    const current = shown;
    const placed = current ? placeTiles(current, view) : [];
    const level = current ? tileLevelFor(camera.zoom, current.levels.ladder.length) : 0;
    const tiles = current
      ? tileInstances(camera, view, current.levels.ladder, current.levels.tileSize, placed)
      : new Float32Array(0);
    sentFrame += 1;
    post(
      {
        type: "frame",
        id: sentFrame,
        frame: {
          tiles: tiles.buffer,
          tileCount: placed.length,
          nearest:
            interpolationRule === "finest-nearest" &&
            magnifiesFinestLevel(level, camera.zoom, pixelRatio()),
          tint: brightness,
          view: { x: camera.x, y: camera.y, scale: 2 ** camera.zoom, ...view },
          layers: drawnLayers(),
        },
      },
      [tiles.buffer],
    );
    if (placed.some((tile) => tile.alpha < 1)) changed();
  };

  const mayRecover = (): boolean => {
    const time = now();
    recentLosses = [...recentLosses.filter((at) => time - at < defaultLossWindowMs), time];
    return recentLosses.length <= defaultMaxLossesInWindow;
  };

  const recover = () => {
    recoveries += 1;
    awaitingLoss = false;
    maxLayers = null;
    atlas = null;
    if (shown !== null) dropTiles(shown);
    sentLayers.clear();
    pinAtlasSent = false;
    glyphLayout = null;
    post({ type: "restore" });
    sendSize();
    syncOverlays(null);
    changed();
  };

  worker.addEventListener("message", (event: MessageEvent<RenderResponse>) => {
    const response = event.data;
    if (destroyed) return;
    if (response.type === "ready") {
      maxLayers = response.maxLayers;
      changed();
    }
    if (response.type === "drawn") drawnFrame = Math.max(drawnFrame, response.id);
    if (response.type === "gpuTime") gpuTimes.push(response.ms);
    if (response.type === "leftOut") {
      reportLeftOut(response.id, response.bytes, response.limit);
    }
    if (response.type === "error") {
      if (response.source === "uncaptured") {
        uncaptured += 1;
        reportError(new WebGpuError("uncaptured", response.message));
      } else if (response.source === "device-lost" && mayRecover()) {
        recover();
      } else {
        fail(
          new WebGpuError(
            "device-lost",
            response.source === "start"
              ? `No WebGPU device was created: ${response.message}`
              : response.message,
          ),
        );
      }
    }
  });
  worker.addEventListener("error", (event: ErrorEvent) => {
    fail(new WebGpuError("device-lost", `The render worker failed: ${event.message}`));
  });

  const offscreen = canvas.transferControlToOffscreen();
  post({ type: "init", canvas: offscreen, timing: options.gpuTiming === true }, [offscreen]);
  sendSize();

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
      cache:
        slide.bytes ?? createRangeCache(opened.fetch === undefined ? {} : { fetch: opened.fetch }),
      ...(options.spawnDecodeWorker ? { spawn: options.spawnDecodeWorker } : {}),
    });
    reader.ready.catch(reportOnce);
    reader.setFocus({ x: camera.x, y: camera.y });
    return reader;
  };

  const release = (current: Shown | null) => {
    if (current === null) return;
    dropTiles(current);
    current.reader?.dispose();
    atlas = null;
  };

  const showSlide = (slide: PixelSlide | null) => {
    if (failure !== null || slide === shown?.slide) return;
    const previous = shown;
    shown = null;
    release(previous);
    changed();
    if (slide === null) return;
    if (slide.source.photometric !== "rgb" || slide.source.dtype !== "uint8") {
      throw new UnsupportedCustomWebGpuSourceError(
        `this slide is ${slide.source.photometric} with ${slide.source.dtype} samples`,
      );
    }
    const reader = readerFor(slide);
    shown = disposingOnThrow(reader, () => ({
      slide,
      levels: createVivLevels(slide.source, {
        onTileError: options.onTileError ?? reportError,
        onReadSettled: changed,
        ...(reader ? { read: reader.read } : {}),
      }),
      reader,
      tiles: new Map<string, TileEntry>(),
    }));
  };

  const settled = (): boolean => {
    if (failure !== null) return true;
    if (destroyed || maxLayers === null || awaitingLoss) return false;
    if (dirty || frameHandle !== null || drawnFrame !== sentFrame || sentFrame === 0) return false;
    if (shown === null) return true;
    return loading === 0 && shown.levels.pending() === 0 && (shown.reader?.idle() ?? true);
  };

  const whenIdle = (signal?: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      let calm = 0;
      const check = () => {
        if (destroyed) {
          reject(new Error("The custom WebGPU route was destroyed before it settled"));
          return;
        }
        if (signal?.aborted) {
          reject(
            new Error("Waiting for the custom WebGPU route was aborted", { cause: signal.reason }),
          );
          return;
        }
        if (failure !== null) {
          reject(failure);
          return;
        }
        calm = settled() ? calm + 1 : 0;
        if (calm >= idleFramesRequired) {
          resolve();
          return;
        }
        requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    });

  const resized = () => {
    sendSize();
    changed();
  };
  const stopObservingCanvas = observeCanvasSize(canvas, resized);
  const stopObservingPixelRatio = observePixelRatio(resized);

  return {
    canvas,
    whenIdle,
    isSettled: settled,
    loadState: () => shown?.levels.loadState() ?? idleLoadState,
    decodeStats: () => shown?.reader?.stats() ?? null,
    uncapturedGpuErrors: () => uncaptured,
    overlayBufferWrites: () => overlayWrites,
    failure: () => failure,
    deviceRecoveries: () => recoveries,
    redraw: changed,
    takeGpuTimes: () => {
      const taken = gpuTimes;
      gpuTimes = [];
      return taken;
    },
    loseDevice: () => {
      if (!usable()) return;
      awaitingLoss = true;
      post({ type: "lose" });
    },
    showSlide,
    setCamera: (next) => {
      camera = next;
      shown?.reader?.setFocus({ x: camera.x, y: camera.y });
      changed();
    },
    setOverlays: (next) => {
      overlays = next;
      syncOverlays(null);
      changed();
    },
    setSlideBrightness: (factor) => {
      if (factor === brightness) return;
      brightness = factor;
      changed();
    },
    invalidateOverlay: (id) => {
      if (!overlays.some((overlay) => overlay.id === id)) return;
      syncOverlays(id);
      changed();
    },
    destroy: () => {
      if (destroyed) return;
      const previous = shown;
      shown = null;
      release(previous);
      post({ type: "destroy" });
      destroyed = true;
      if (frameHandle !== null) cancelAnimationFrame(frameHandle);
      frameHandle = null;
      stopObservingCanvas();
      stopObservingPixelRatio();
      worker.terminate();
      canvas.remove();
    },
  };
}

export function customWebGpuRendererFactory(options: CustomWebGpuRouteOptions = {}) {
  return (container: EngineContainer): CustomWebGpuRoute =>
    createCustomWebGpuRoute(container, options);
}
