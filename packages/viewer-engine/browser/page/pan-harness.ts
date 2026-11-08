import {
  type BoundViewHistory,
  bindViewerInput,
  bindViewHistory,
  type Camera,
  createDefaultPixelSourceRegistry,
  createViewerEngine,
  type MotionVector,
  type PrefetchStats,
  type SlideFormatId,
  type ViewerEngine,
  type ViewerInputBinding,
  viewRestMs,
  zoomForMagnification,
} from "../../src/index.ts";
import {
  createPixelSlideOpener,
  type DecodeStats,
  type PixelSlide,
  pixelSlide,
  type VivRoute,
  vivRendererFactory,
} from "../../src/viv/index.ts";

export interface PanSlide {
  readonly url: string;
  readonly formatId: SlideFormatId;
  readonly workers: number;
  readonly reader: "shared-bytes" | "geotiff-direct";
  readonly magnification: number | null;
  readonly prefetch?: boolean;
  readonly x: number;
  readonly y: number;
}

export interface JumpTarget {
  readonly magnification: number;
  readonly x: number;
  readonly y: number;
}

export interface Opened {
  readonly openMs: number;
  readonly decode: DecodeStats | null;
}

export interface JumpReport {
  readonly sharpMs: number;
  readonly decode: DecodeStats | null;
  readonly errors: readonly string[];
}

export interface PanLeg {
  readonly dx: number;
  readonly dy: number;
  readonly frames: number;
}

export interface PanReport {
  readonly frames: number;
  readonly elapsedMs: number;
  readonly settleMs: number;
  readonly camera: Camera;
  readonly decode: DecodeStats | null;
  readonly errors: readonly string[];
}

export interface Drive {
  readonly pxPerSecond: number;
  readonly ms: number;
  readonly zigzagPx: number;
  readonly vertical: boolean;
}

export interface DriveReport extends PanReport {
  readonly prefetch: PrefetchStats | null;
  readonly vector: MotionVector | null;
}

export interface PanHarness {
  drive(plan: Drive, settleTimeoutMs: number): Promise<DriveReport>;
  open(slide: PanSlide): Promise<Opened>;
  jump(target: JumpTarget, settleTimeoutMs: number): Promise<JumpReport>;
  pan(legs: readonly PanLeg[], settleTimeoutMs: number): Promise<PanReport>;
  close(): void;
  rest(): Promise<Camera>;
  flyTo(target: Camera): Promise<Camera>;
  back(): Promise<Camera | null>;
  forward(): Promise<Camera | null>;
  bindWheel(): void;
  startFrames(): void;
  stopFrames(): Promise<FrameReport>;
}

export interface FrameReport {
  readonly frames: number;
  readonly worstMs: number;
  readonly p95Ms: number;
  readonly camera: Camera;
}

declare global {
  interface Window {
    panHarness: PanHarness;
  }
}

const errors: string[] = [];
let engine: ViewerEngine | null = null;
let route: VivRoute | null = null;
let history: BoundViewHistory | null = null;
let wheel: ViewerInputBinding | null = null;
let frameTimes: number[] | null = null;
let lastFrameAt = 0;

globalThis.addEventListener("unhandledrejection", (event) => {
  errors.push(String(event.reason));
});

function viewer(): HTMLElement {
  const element = document.getElementById("viewer");
  if (element === null) throw new Error("The pan page has no #viewer element");
  return element;
}

function nextFrame(): Promise<number> {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

function mounted(): { engine: ViewerEngine; route: VivRoute } {
  if (engine === null || route === null) throw new Error("No slide is open");
  return { engine, route };
}

async function open(slide: PanSlide): Promise<Opened> {
  close();
  const started = performance.now();
  const factory = vivRendererFactory({
    decodeWorkers: slide.workers,
    useDevicePixels: 1,
    ...(slide.prefetch === undefined ? {} : { prefetch: slide.prefetch }),
    onError: (error) => {
      errors.push(error.message);
    },
  });
  const current = createViewerEngine<PixelSlide>({
    createRenderer: (container) => {
      route = factory(container);
      return route;
    },
    openSlide:
      slide.reader === "shared-bytes"
        ? createPixelSlideOpener(() => ({ formatId: slide.formatId, url: slide.url }))
        : async (ref, signal) => {
            const source = await createDefaultPixelSourceRegistry().open({
              formatId: slide.formatId,
              url: slide.url,
              signal,
            });
            return pixelSlide(ref.id, source);
          },
  });
  engine = current;
  history = bindViewHistory(current);
  current.mount(viewer());
  const opened = await current.openSlide({ id: slide.url });
  if (slide.magnification !== null) {
    if (opened.micronsPerPixel === null) throw new Error("The slide has no pixel size");
    current.setCamera({
      x: slide.x,
      y: slide.y,
      zoom: zoomForMagnification(opened.micronsPerPixel, slide.magnification),
    });
  }
  await mounted().route.whenIdle();
  return { openMs: performance.now() - started, decode: mounted().route.decodeStats() };
}

async function jump(target: JumpTarget, settleTimeoutMs: number): Promise<JumpReport> {
  const { engine: current, route: shown } = mounted();
  const micronsPerPixel = current.getSlide()?.micronsPerPixel ?? null;
  if (micronsPerPixel === null) throw new Error("The slide has no pixel size");
  const started = performance.now();
  current.setCamera({
    x: target.x,
    y: target.y,
    zoom: zoomForMagnification(micronsPerPixel, target.magnification),
  });
  await shown.whenIdle(AbortSignal.timeout(settleTimeoutMs));
  return {
    sharpMs: performance.now() - started,
    decode: shown.decodeStats(),
    errors: [...errors],
  };
}

async function pan(legs: readonly PanLeg[], settleTimeoutMs: number): Promise<PanReport> {
  const { engine: current, route: shown } = mounted();
  const started = performance.now();
  let frames = 0;
  for (const leg of legs) {
    for (let frame = 0; frame < leg.frames; frame++) {
      await nextFrame();
      const camera = current.getCamera();
      const scale = 2 ** camera.zoom;
      current.setCamera({
        x: camera.x + leg.dx / scale,
        y: camera.y + leg.dy / scale,
        zoom: camera.zoom,
      });
      frames++;
    }
  }
  const moved = performance.now();
  await shown.whenIdle(AbortSignal.timeout(settleTimeoutMs));
  const settled = performance.now();
  return {
    frames,
    elapsedMs: moved - started,
    settleMs: settled - moved,
    camera: current.getCamera(),
    decode: shown.decodeStats(),
    errors: [...errors],
  };
}

async function drive(plan: Drive, settleTimeoutMs: number): Promise<DriveReport> {
  const { engine: current, route: shown } = mounted();
  const started = performance.now();
  let last = await nextFrame();
  let frames = 0;
  let sign = 1;
  let maxVector: MotionVector | null = null;
  while (last - started < plan.ms) {
    const now = await nextFrame();
    const dt = now - last;
    last = now;
    const camera = current.getCamera();
    const scale = 2 ** camera.zoom;
    const along = (plan.pxPerSecond * dt) / 1000;
    const across = plan.zigzagPx > 0 ? sign * plan.zigzagPx : 0;
    sign = -sign;
    const dx = plan.vertical ? across : along;
    const dy = plan.vertical ? along : across;
    current.setCamera({ x: camera.x + dx / scale, y: camera.y + dy / scale, zoom: camera.zoom });
    frames++;
    const vector = shown.prefetchVector();
    if (vector !== null && (maxVector === null || vector.speed > maxVector.speed)) {
      maxVector = vector;
    }
  }
  const moved = performance.now();
  await shown.whenIdle(AbortSignal.timeout(settleTimeoutMs));
  const settled = performance.now();
  return {
    frames,
    elapsedMs: moved - started,
    settleMs: settled - moved,
    camera: current.getCamera(),
    decode: shown.decodeStats(),
    errors: [...errors],
    prefetch: shown.prefetchStats(),
    vector: maxVector,
  };
}

async function rest(): Promise<Camera> {
  const { engine: current } = mounted();
  while (current.getMotion() !== "idle") await nextFrame();
  await new Promise((resolve) => setTimeout(resolve, viewRestMs + 100));
  return current.getCamera();
}

async function flyTo(target: Camera): Promise<Camera> {
  await mounted().engine.flyTo(target);
  return rest();
}

async function step(move: (bound: BoundViewHistory) => boolean): Promise<Camera | null> {
  if (history === null) throw new Error("No slide is open");
  return move(history) ? rest() : null;
}

function bindWheel(): void {
  wheel?.dispose();
  wheel = bindViewerInput(viewer(), mounted().engine, { wheelMode: "auto" });
}

function sampleFrame(now: number): void {
  if (frameTimes === null) return;
  frameTimes.push(now - lastFrameAt);
  lastFrameAt = now;
  requestAnimationFrame(sampleFrame);
}

function startFrames(): void {
  frameTimes = [];
  lastFrameAt = performance.now();
  requestAnimationFrame(sampleFrame);
}

async function stopFrames(): Promise<FrameReport> {
  const { engine: current, route: shown } = mounted();
  await shown.whenIdle(AbortSignal.timeout(60_000));
  const sampled = frameTimes ?? [];
  frameTimes = null;
  const sorted = [...sampled].sort((a, b) => a - b);
  return {
    frames: sorted.length,
    worstMs: sorted.at(-1) ?? 0,
    p95Ms: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
    camera: current.getCamera(),
  };
}

function close(): void {
  wheel?.dispose();
  wheel = null;
  frameTimes = null;
  history?.dispose();
  history = null;
  engine?.dispose();
  engine = null;
  route = null;
  errors.length = 0;
}

window.panHarness = {
  open,
  drive,
  jump,
  pan,
  close,
  rest,
  flyTo,
  back: () => step((bound) => bound.back()),
  forward: () => step((bound) => bound.forward()),
  bindWheel,
  startFrames,
  stopFrames,
};
