import "./frame-probe.ts";
import type { Layer } from "@deck.gl/core";
import {
  type Camera,
  createPolygonBatch,
  createVectorOverlay,
  createViewerEngine,
  type ViewerEngine,
} from "../../src/index.ts";
import { cameraViewRect } from "../../src/overlay/cull-grid.ts";
import {
  createPixelSlideOpener,
  type PixelSlide,
  type VivRoute,
  vivRendererFactory,
} from "../../src/viv/index.ts";

export interface CullOpened {
  readonly width: number;
  readonly height: number;
  readonly total: number;
  readonly originX: number;
  readonly originY: number;
}

export interface CullLayer {
  readonly id: string;
  readonly length: number;
  readonly visible: boolean;
}

export interface CullState {
  readonly layers: readonly CullLayer[];
  readonly drawnShapes: number;
  readonly touching: number;
  readonly touchingMissing: number;
  readonly drawnKeys: readonly string[];
  readonly view: readonly [number, number, number, number];
  readonly errors: readonly string[];
}

export interface CullHarness {
  open(slideUrl: string, perRow: number): Promise<CullOpened>;
  show(camera: Camera): Promise<CullState>;
  close(): void;
}

declare global {
  interface Window {
    cullHarness: CullHarness;
  }
}

const side = 6;
const pitch = 20;
const errors: string[] = [];

interface Opened {
  readonly engine: ViewerEngine;
  readonly route: VivRoute;
  readonly perRow: number;
  readonly originX: number;
  readonly originY: number;
}

let opened: Opened | null = null;

function viewer(): HTMLElement {
  const element = document.getElementById("viewer");
  if (element === null) throw new Error("The page has no #viewer element");
  return element;
}

function current(): Opened {
  if (opened === null) throw new Error("No slide is open");
  return opened;
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function open(slideUrl: string, perRow: number): Promise<CullOpened> {
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
  const count = perRow * perRow;
  const originX = info.width / 2 - (perRow * pitch) / 2;
  const originY = info.height / 2 - (perRow * pitch) / 2;
  const positions = new Float32Array(count * 8);
  const starts = new Uint32Array(count + 1);
  const colors = new Uint8Array(count * 4);
  for (let shape = 0; shape < count; shape++) {
    const x = originX + (shape % perRow) * pitch;
    const y = originY + Math.floor(shape / perRow) * pitch;
    positions.set([x, y, x + side, y, x + side, y + side, x, y + side], shape * 8);
    starts[shape + 1] = (shape + 1) * 4;
    colors.set([220, 20, 60, 255], shape * 4);
  }
  const shown: VivRoute = route;
  shown.setOverlays([
    createVectorOverlay({
      id: "nuclei",
      kind: "nuclei",
      shapes: { polygons: createPolygonBatch({ positions, starts, colors }) },
    }),
  ]);
  opened = { engine, route: shown, perRow, originX, originY };
  return { width: info.width, height: info.height, total: count, originX, originY };
}

function flatLayers(layers: unknown): Layer[] {
  if (!Array.isArray(layers)) return layers ? [layers as Layer] : [];
  return layers.flatMap((layer) => flatLayers(layer));
}

interface Attribute {
  readonly value?: ArrayLike<number>;
  readonly size?: number;
}

interface LayerData {
  readonly length?: number;
  readonly startIndices?: ArrayLike<number>;
  readonly attributes?: Record<string, Attribute | undefined>;
}

function firstVertices(data: LayerData): Array<[number, number]> {
  const attribute = data.attributes?.["getPolygon"] ?? data.attributes?.["getPath"];
  const value = attribute?.value;
  const size = attribute?.size ?? 2;
  const startIndices = data.startIndices;
  if (value === undefined || startIndices === undefined) return [];
  const vertices: Array<[number, number]> = [];
  for (let item = 0; item < (data.length ?? 0); item++) {
    const at = (startIndices[item] ?? 0) * size;
    vertices.push([value[at] ?? 0, value[at + 1] ?? 0]);
  }
  return vertices;
}

async function show(camera: Camera): Promise<CullState> {
  const { route, perRow, originX, originY } = current();
  route.setCamera(camera);
  await route.whenIdle(AbortSignal.timeout(30_000));
  await nextFrame();
  await nextFrame();
  const canvas = route.canvas;
  const view = cameraViewRect(camera, canvas.clientWidth, canvas.clientHeight);
  if (view === undefined) throw new Error("The canvas has no size");
  const nucleiLayers = flatLayers(route.deck.props.layers).filter((layer) =>
    layer.id.startsWith("overlay:nuclei:"),
  );
  const layers = nucleiLayers.map((layer) => ({
    id: layer.id,
    length: (layer.props.data as LayerData | undefined)?.length ?? 0,
    visible: layer.props.visible !== false,
  }));
  const keys = new Set<string>();
  for (const layer of nucleiLayers) {
    if (layer.props.visible === false) continue;
    for (const [x, y] of firstVertices(layer.props.data as LayerData)) {
      keys.add(`${Math.round((x - originX) / pitch)},${Math.round((y - originY) / pitch)}`);
    }
  }
  const [left, top, right, bottom] = view;
  let touching = 0;
  let touchingMissing = 0;
  const firstColumn = Math.max(0, Math.floor((left - side - originX) / pitch));
  const lastColumn = Math.min(perRow - 1, Math.ceil((right - originX) / pitch));
  const firstRow = Math.max(0, Math.floor((top - side - originY) / pitch));
  const lastRow = Math.min(perRow - 1, Math.ceil((bottom - originY) / pitch));
  for (let row = firstRow; row <= lastRow; row++) {
    for (let column = firstColumn; column <= lastColumn; column++) {
      const x = originX + column * pitch;
      const y = originY + row * pitch;
      if (x + side < left || x > right || y + side < top || y > bottom) continue;
      touching++;
      if (!keys.has(`${column},${row}`)) touchingMissing++;
    }
  }
  return {
    layers,
    drawnShapes: keys.size,
    touching,
    touchingMissing,
    drawnKeys: [...keys].sort(),
    view,
    errors: [...errors],
  };
}

function close(): void {
  opened?.engine.dispose();
  opened = null;
  errors.length = 0;
  viewer().replaceChildren();
}

window.cullHarness = { open, show, close };
