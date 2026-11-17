import {
  type CustomWebGpuRoute,
  customWebGpuRendererFactory,
} from "../../src/custom-webgpu/index.ts";
import {
  createPolygonBatch,
  createVectorOverlay,
  createViewerEngine,
  type OverlayLayer,
} from "../../src/index.ts";
import { createPixelSlideOpener, type PixelSlide } from "../../src/viv/index.ts";
import type { CaseRequest, FrameStats } from "./gpu-timing-harness.ts";

export interface CustomCaseReport {
  readonly name: string;
  readonly nuclei: number;
  readonly pixelsPerUnit: number;
  readonly buildBatchMs: number;
  readonly withOverlay: FrameStats;
  readonly withoutOverlay: FrameStats;
  readonly overlayDeltaMs: number;
  readonly errors: readonly string[];
  readonly uncapturedGpuErrors: number;
}

export interface CustomGpuInfo {
  readonly userAgent: string;
  readonly devicePixelRatio: number;
  readonly canvas: { readonly width: number; readonly height: number };
  readonly slide: { readonly width: number; readonly height: number };
}

export interface CustomGpuTimingHarness {
  open(slideUrl: string): Promise<CustomGpuInfo>;
  run(request: CaseRequest): Promise<CustomCaseReport>;
  clearOverlays(): Promise<void>;
  close(): void;
}

declare global {
  interface Window {
    customGpuTiming: CustomGpuTimingHarness;
  }
}

const side = 6;
const pitch = 20;

interface Opened {
  readonly route: CustomWebGpuRoute;
  readonly width: number;
  readonly height: number;
  readonly dispose: () => void;
}

let opened: Opened | null = null;
const errors: string[] = [];

function viewer(): HTMLElement {
  const element = document.getElementById("viewer");
  if (element === null) throw new Error("The page has no #viewer element");
  return element;
}

function statsOf(values: readonly number[]): FrameStats {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (fraction: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
  return {
    medianMs: at(0.5),
    p95Ms: at(0.95),
    minMs: sorted[0] ?? 0,
    maxMs: sorted[sorted.length - 1] ?? 0,
    samples: sorted.length,
  };
}

function close(): void {
  opened?.dispose();
  opened = null;
  errors.length = 0;
  viewer().replaceChildren();
}

async function open(slideUrl: string): Promise<CustomGpuInfo> {
  close();
  let route: CustomWebGpuRoute | null = null;
  const factory = customWebGpuRendererFactory({
    decodeWorkers: 1,
    gpuTiming: true,
    onError: (error) => {
      errors.push(error.message);
    },
  });
  const engine = createViewerEngine<PixelSlide>({
    createRenderer: (container) => {
      route = factory(container);
      return route;
    },
    openSlide: createPixelSlideOpener(() => ({ formatId: "ome-tiff", url: slideUrl })),
  });
  engine.mount(viewer());
  const info = await engine.openSlide({ id: slideUrl });
  if (route === null) throw new Error("The engine made no custom WebGPU route");
  const shown: CustomWebGpuRoute = route;
  opened = {
    route: shown,
    width: info.width,
    height: info.height,
    dispose: () => engine.dispose(),
  };
  await shown.whenIdle(AbortSignal.timeout(60_000));
  return {
    userAgent: navigator.userAgent,
    devicePixelRatio: window.devicePixelRatio,
    canvas: {
      width: Math.round(shown.canvas.clientWidth * window.devicePixelRatio),
      height: Math.round(shown.canvas.clientHeight * window.devicePixelRatio),
    },
    slide: { width: info.width, height: info.height },
  };
}

function nucleiOverlay(perRow: number, centreX: number, centreY: number): OverlayLayer {
  const count = perRow * perRow;
  const positions = new Float32Array(count * 8);
  const starts = new Uint32Array(count + 1);
  const colors = new Uint8Array(count * 4).fill(255);
  const originX = centreX - (perRow * pitch) / 2;
  const originY = centreY - (perRow * pitch) / 2;
  for (let shape = 0; shape < count; shape++) {
    const x = originX + (shape % perRow) * pitch;
    const y = originY + Math.floor(shape / perRow) * pitch;
    positions.set([x, y, x + side, y, x + side, y + side, x, y + side], shape * 8);
    starts[shape + 1] = (shape + 1) * 4;
  }
  return createVectorOverlay({
    id: "nuclei",
    kind: "nuclei",
    shapes: { polygons: createPolygonBatch({ positions, starts, colors }) },
  });
}

async function measure(route: CustomWebGpuRoute, warmup: number, frames: number) {
  const times: number[] = [];
  route.takeGpuTimes();
  for (let frame = 0; frame < warmup + frames; frame++) {
    route.redraw();
    await route.whenIdle(AbortSignal.timeout(120_000));
    const taken = route.takeGpuTimes();
    const last = taken[taken.length - 1];
    if (frame >= warmup && last !== undefined) times.push(last);
  }
  return times;
}

async function run(request: CaseRequest): Promise<CustomCaseReport> {
  if (opened === null) throw new Error("No slide is open");
  const { route, width, height } = opened;
  const centreX = width / 2;
  const centreY = height / 2;
  const pixelsPerUnit = request.diameterPx / Math.hypot(side, side);
  const camera = { x: centreX, y: centreY, zoom: Math.log2(pixelsPerUnit) };
  const failures = errors.length;

  const builtFrom = performance.now();
  const overlay = nucleiOverlay(request.perRow, centreX, centreY);
  const buildBatchMs = performance.now() - builtFrom;

  route.setOverlays([]);
  route.setCamera(camera);
  await route.whenIdle(AbortSignal.timeout(120_000));
  const without = await measure(route, request.warmup, request.frames);

  route.setOverlays([overlay]);
  route.setCamera(camera);
  await route.whenIdle(AbortSignal.timeout(120_000));
  const withOverlay = await measure(route, request.warmup, request.frames);

  const withStats = statsOf(withOverlay);
  const withoutStats = statsOf(without);
  return {
    name: request.name,
    nuclei: request.perRow * request.perRow,
    pixelsPerUnit,
    buildBatchMs,
    withOverlay: withStats,
    withoutOverlay: withoutStats,
    overlayDeltaMs: withStats.medianMs - withoutStats.medianMs,
    errors: errors.slice(failures),
    uncapturedGpuErrors: route.uncapturedGpuErrors(),
  };
}

async function clearOverlays(): Promise<void> {
  if (opened === null) throw new Error("Open a slide first");
  opened.route.setOverlays([]);
  await opened.route.whenIdle(AbortSignal.timeout(120_000));
}

window.customGpuTiming = { open, run, clearOverlays, close };
