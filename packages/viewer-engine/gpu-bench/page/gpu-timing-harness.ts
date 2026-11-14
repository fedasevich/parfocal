import {
  createPolygonBatch,
  createVectorOverlay,
  createViewerEngine,
  type OverlayLayer,
} from "../../src/index.ts";
import {
  createPixelSlideOpener,
  type PixelSlide,
  type VivRoute,
  vivRendererFactory,
} from "../../src/viv/index.ts";

export type TimingSource = "timer-query" | "fence";

export interface CaseRequest {
  readonly name: string;
  readonly perRow: number;
  readonly diameterPx: number;
  readonly frames: number;
  readonly warmup: number;
}

export interface FrameStats {
  readonly medianMs: number;
  readonly p95Ms: number;
  readonly minMs: number;
  readonly maxMs: number;
  readonly samples: number;
}

export interface CaseReport {
  readonly name: string;
  readonly nuclei: number;
  readonly pixelsPerUnit: number;
  readonly buildBatchMs: number;
  readonly source: TimingSource;
  readonly withOverlay: FrameStats;
  readonly withoutOverlay: FrameStats;
  readonly overlayDeltaMs: number;
  readonly fenceWithOverlay: FrameStats;
  readonly fenceWithoutOverlay: FrameStats;
  readonly submitWithOverlayMs: number;
  readonly errors: readonly string[];
}

export interface GpuInfo {
  readonly userAgent: string;
  readonly renderer: string | null;
  readonly vendor: string | null;
  readonly devicePixelRatio: number;
  readonly canvas: { readonly width: number; readonly height: number };
  readonly timerQuery: boolean;
  readonly slide: { readonly width: number; readonly height: number };
}

export interface GpuTimingHarness {
  open(slideUrl: string): Promise<GpuInfo>;
  run(request: CaseRequest): Promise<CaseReport>;
  close(): void;
}

declare global {
  interface Window {
    gpuTiming: GpuTimingHarness;
  }
}

const side = 6;
const pitch = 20;
const timerExtension = "EXT_disjoint_timer_query_webgl2";

interface TimerQueryExtension {
  readonly TIME_ELAPSED_EXT: number;
  readonly GPU_DISJOINT_EXT: number;
}

interface Opened {
  readonly route: VivRoute;
  readonly gl: WebGL2RenderingContext;
  readonly timer: TimerQueryExtension | null;
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

function current(): Opened {
  if (opened === null) throw new Error("No slide is open");
  return opened;
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

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function glOf(route: VivRoute): WebGL2RenderingContext {
  const device = (route.deck as unknown as { device?: { gl?: WebGL2RenderingContext } }).device;
  if (device?.gl === undefined) throw new Error("The Viv route has no WebGL2 context");
  return device.gl;
}

async function open(slideUrl: string): Promise<GpuInfo> {
  close();
  let route: VivRoute | null = null;
  const factory = vivRendererFactory({
    decodeWorkers: 1,
    prefetch: false,
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
  if (route === null) throw new Error("The engine made no Viv route");
  const shown: VivRoute = route;
  const gl = glOf(shown);
  const timer = gl.getExtension(timerExtension) as TimerQueryExtension | null;
  opened = {
    route: shown,
    gl,
    timer,
    width: info.width,
    height: info.height,
    dispose: () => engine.dispose(),
  };
  const debug = gl.getExtension("WEBGL_debug_renderer_info");
  const canvas = shown.canvas;
  return {
    userAgent: navigator.userAgent,
    renderer: debug === null ? null : String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)),
    vendor: debug === null ? null : String(gl.getParameter(debug.UNMASKED_VENDOR_WEBGL)),
    devicePixelRatio: window.devicePixelRatio,
    canvas: { width: canvas.width, height: canvas.height },
    timerQuery: timer !== null,
    slide: { width: info.width, height: info.height },
  };
}

function close(): void {
  opened?.dispose();
  opened = null;
  errors.length = 0;
  viewer().replaceChildren();
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

async function settle(route: VivRoute): Promise<void> {
  await route.whenIdle(AbortSignal.timeout(60_000));
  await nextFrame();
  await nextFrame();
}

interface Sample {
  readonly fenceMs: number;
  readonly queryMs: number | null;
  readonly submitMs: number;
}

const yieldChannel = new MessageChannel();

function yieldTask(): Promise<void> {
  return new Promise((resolve) => {
    yieldChannel.port1.onmessage = () => resolve();
    yieldChannel.port2.postMessage(null);
  });
}

async function fenceWait(gl: WebGL2RenderingContext): Promise<void> {
  const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  if (fence === null) throw new Error("The context made no fence");
  gl.flush();
  while (gl.clientWaitSync(fence, 0, 0) === gl.TIMEOUT_EXPIRED) {
    await yieldTask();
  }
  gl.deleteSync(fence);
}

async function sampleFrame({ route, gl, timer }: Opened): Promise<Sample> {
  const query = timer === null ? null : gl.createQuery();
  const started = performance.now();
  if (query !== null && timer !== null) gl.beginQuery(timer.TIME_ELAPSED_EXT, query);
  route.deck.redraw("gpu-timing");
  const submitted = performance.now();
  if (query !== null && timer !== null) gl.endQuery(timer.TIME_ELAPSED_EXT);
  await fenceWait(gl);
  const fenceMs = performance.now() - started;
  let queryMs: number | null = null;
  if (query !== null && timer !== null) {
    const disjoint = gl.getParameter(timer.GPU_DISJOINT_EXT) === true;
    if (!disjoint && gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE) === true) {
      queryMs = Number(gl.getQueryParameter(query, gl.QUERY_RESULT)) / 1e6;
    }
    gl.deleteQuery(query);
  }
  return { fenceMs, queryMs, submitMs: submitted - started };
}

interface Measured {
  readonly query: readonly number[];
  readonly fence: readonly number[];
  readonly submit: readonly number[];
}

async function measure(state: Opened, warmup: number, frames: number): Promise<Measured> {
  for (let frame = 0; frame < warmup; frame++) await sampleFrame(state);
  const query: number[] = [];
  const fence: number[] = [];
  const submit: number[] = [];
  for (let frame = 0; frame < frames; frame++) {
    const sample = await sampleFrame(state);
    fence.push(sample.fenceMs);
    submit.push(sample.submitMs);
    if (sample.queryMs !== null) query.push(sample.queryMs);
  }
  return { query, fence, submit };
}

function median(values: readonly number[]): number {
  return statsOf(values).medianMs;
}

async function run(request: CaseRequest): Promise<CaseReport> {
  const state = current();
  const { route } = state;
  const centreX = state.width / 2;
  const centreY = state.height / 2;
  const pixelsPerUnit = request.diameterPx / Math.hypot(side, side);
  const camera = { x: centreX, y: centreY, zoom: Math.log2(pixelsPerUnit) };
  const failures = errors.length;

  const builtFrom = performance.now();
  const overlay = nucleiOverlay(request.perRow, centreX, centreY);
  const buildBatchMs = performance.now() - builtFrom;

  route.setOverlays([]);
  route.setCamera(camera);
  await settle(route);
  const without = await measure(state, request.warmup, request.frames);

  route.setOverlays([overlay]);
  route.setCamera(camera);
  await settle(route);
  const withOverlay = await measure(state, request.warmup, request.frames);

  route.setOverlays([]);
  const useQuery = withOverlay.query.length >= request.frames / 2 && without.query.length >= 1;
  const source: TimingSource = useQuery ? "timer-query" : "fence";
  const pick = (measured: Measured) => (useQuery ? measured.query : measured.fence);
  return {
    name: request.name,
    nuclei: request.perRow * request.perRow,
    pixelsPerUnit,
    buildBatchMs,
    source,
    withOverlay: statsOf(pick(withOverlay)),
    withoutOverlay: statsOf(pick(without)),
    overlayDeltaMs: median(pick(withOverlay)) - median(pick(without)),
    fenceWithOverlay: statsOf(withOverlay.fence),
    fenceWithoutOverlay: statsOf(without.fence),
    submitWithOverlayMs: median(withOverlay.submit),
    errors: errors.slice(failures),
  };
}

window.gpuTiming = { open, run, close };
