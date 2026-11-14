import { Deck, OrthographicView } from "@deck.gl/core";
import { SolidPolygonLayer } from "@deck.gl/layers";
import {
  finishedTileMarks,
  httpRunStreamSource,
  type PolygonBatch,
  type Rgba,
  type RunProgress,
  RunStream,
  type SceneBlock,
  StreamedScene,
} from "../../src/index.ts";
import { polygonFillData } from "../../src/overlay/deck/binary-data.ts";
import { deckDeviceProps, unpickableLayerProps } from "../../src/viv/deck-settings.ts";

export interface StreamConfig {
  readonly origin: string;
  readonly lineage: string;
  readonly slideWidth: number;
  readonly slideHeight: number;
  readonly pollMs: number;
}

export interface RebuildEntry {
  readonly status: string;
  readonly drawn: number;
  readonly blocks: number;
  readonly pass: number;
  readonly at: number;
}

export interface StreamState {
  readonly progress: RunProgress | null;
  readonly drawn: number;
  readonly marks: number;
  readonly rebuilds: readonly RebuildEntry[];
  readonly frames: number;
  readonly longestFrameMs: number;
  readonly framesOver: number;
  readonly longestTaskMs: number;
  readonly error: string | null;
}

export interface StreamHarness {
  prepare(config: StreamConfig): Promise<void>;
  start(config: StreamConfig): Promise<void>;
  cancel(): Promise<void>;
  finished(): Promise<StreamState>;
  state(): StreamState;
}

declare global {
  interface Window {
    streamHarness: StreamHarness;
  }
}

const viewSize = 512;
const frameLimitMs = 33;
const vsyncJitterMs = 1;
const markColor: Rgba = [40, 160, 220, 40];
const palette: readonly Rgba[] = [
  [214, 69, 65, 200],
  [65, 131, 215, 200],
  [46, 160, 67, 200],
  [230, 160, 40, 200],
  [150, 80, 200, 200],
];

let deck: Deck<OrthographicView> | null = null;
let stream: RunStream | null = null;
let running: Promise<RunProgress> | null = null;
let progress: RunProgress | null = null;
let drawn = 0;
let marks = 0;
let error: string | null = null;
const rebuilds: RebuildEntry[] = [];
const fillData = new WeakMap<PolygonBatch, ReturnType<typeof polygonFillData>>();

let frames = 0;
let longestFrameMs = 0;
let framesOver = 0;
let longestTaskMs = 0;
let watching = false;

function watchFrames(): void {
  watching = true;
  let last = performance.now();
  const tick = (now: number) => {
    const gap = now - last;
    last = now;
    frames++;
    longestFrameMs = Math.max(longestFrameMs, gap);
    if (gap > frameLimitMs + vsyncJitterMs) framesOver++;
    if (watching) requestAnimationFrame(tick);
  };
  requestAnimationFrame((now) => {
    last = now;
    requestAnimationFrame(tick);
  });
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) longestTaskMs = Math.max(longestTaskMs, entry.duration);
  }).observe({ type: "longtask", buffered: false });
}

function dataOf(batch: PolygonBatch): ReturnType<typeof polygonFillData> {
  const found = fillData.get(batch);
  if (found) return found;
  const created = polygonFillData(batch);
  fillData.set(batch, created);
  return created;
}

function fillLayer(id: string, batch: PolygonBatch) {
  return new SolidPolygonLayer({
    id,
    data: dataOf(batch),
    _normalize: false,
    positionFormat: "XY",
    filled: true,
    extruded: false,
    ...unpickableLayerProps,
  } as never);
}

function draw(blocks: readonly SceneBlock[]): void {
  const tiles = stream?.progress().tiles ?? [];
  const tileMarks = finishedTileMarks(tiles, markColor);
  marks = tileMarks.count;
  drawn = blocks.reduce((sum, block) => sum + block.batch.count, 0);
  rebuilds.push({
    status: stream?.progress().status ?? "queued",
    drawn,
    blocks: blocks.length,
    pass: stream?.progress().rebuilds ?? 0,
    at: performance.now(),
  });
  deck?.setProps({
    layers: [
      fillLayer("finished-tiles", tileMarks),
      ...blocks.map((block) => fillLayer(block.id, block.batch)),
    ],
  });
}

async function openDeck(config: StreamConfig): Promise<void> {
  const canvas = document.createElement("canvas");
  canvas.style.width = `${viewSize}px`;
  canvas.style.height = `${viewSize}px`;
  canvas.style.display = "block";
  document.body.append(canvas);
  const side = Math.max(config.slideWidth, config.slideHeight);
  await new Promise<void>((resolve) => {
    deck = new Deck<OrthographicView>({
      canvas,
      deviceProps: deckDeviceProps,
      views: new OrthographicView({ id: "slide", controller: false }),
      viewState: {
        target: [config.slideWidth / 2, config.slideHeight / 2, 0],
        zoom: Math.log2(viewSize / side),
      },
      width: viewSize,
      height: viewSize,
      useDevicePixels: 1,
      layers: [],
      onAfterRender: () => resolve(),
    });
  });
}

async function prepare(config: StreamConfig): Promise<void> {
  if (deck === null) await openDeck(config);
}

async function start(config: StreamConfig): Promise<void> {
  await prepare(config);
  watchFrames();
  const palettePick = (classIndex: number): Rgba =>
    palette[classIndex % palette.length] ?? [0, 0, 0, 255];
  stream = new RunStream({
    lineage: config.lineage,
    scene: new StreamedScene(),
    pollMs: config.pollMs,
    source: httpRunStreamSource({
      areasUrl: (after) => `${config.origin}/areas?after=${after}`,
      tileUrl: (unit) => `${config.origin}/tile/${unit}`,
      cancel: async () => {
        await fetch(`${config.origin}/cancel`, { method: "POST" });
      },
      colorOf: palettePick,
    }),
    onProgress: (next) => {
      progress = next;
    },
    onRebuild: draw,
  });
  running = stream.start();
  running.catch((failure: unknown) => {
    error = failure instanceof Error ? failure.message : String(failure);
  });
}

function state(): StreamState {
  return {
    progress,
    drawn,
    marks,
    rebuilds,
    frames,
    longestFrameMs,
    framesOver,
    longestTaskMs,
    error,
  };
}

async function settleFrames(count: number): Promise<void> {
  for (let frame = 0; frame < count; frame++) {
    await new Promise<number>((resolve) => requestAnimationFrame(resolve));
  }
}

window.streamHarness = {
  prepare,
  start,
  cancel: async () => {
    await stream?.cancel();
  },
  finished: async () => {
    if (running) progress = await running;
    await settleFrames(10);
    watching = false;
    return state();
  },
  state,
};
