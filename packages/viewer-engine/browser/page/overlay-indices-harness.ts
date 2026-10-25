import { Deck, OrthographicView } from "@deck.gl/core";
import { SolidPolygonLayer } from "@deck.gl/layers";
import { createPolygonBatch } from "../../src/index.ts";
import { polygonFillData } from "../../src/overlay/deck/binary-data.ts";
import { deckDeviceProps, unpickableLayerProps } from "../../src/viv/deck-settings.ts";
import { disposeDeck } from "../../src/viv/dispose-deck.ts";

export type TriangulationMode = "precomputed" | "deck";

export interface IndicesReport {
  readonly polygons: number;
  readonly vertices: number;
  readonly batchMs: number;
  readonly updateMs: number;
  readonly frameMs: number;
}

export interface IndicesHarness {
  run(polygons: number, mode: TriangulationMode): Promise<IndicesReport>;
}

declare global {
  interface Window {
    indicesHarness: IndicesHarness;
  }
}

const world = 1000;
const sides = 8;
const viewSize = 256;
const cellPixels = 16;

function cellSize(count: number): number {
  return world / Math.ceil(Math.sqrt(count));
}

function octagons(count: number) {
  const columns = Math.ceil(Math.sqrt(count));
  const cell = cellSize(count);
  const radius = cell * 0.4;
  const positions = new Float32Array(count * sides * 2);
  const starts = new Uint32Array(count + 1);
  const colors = new Uint8Array(count * 4);
  for (let polygon = 0; polygon < count; polygon++) {
    const centreX = (polygon % columns) * cell + cell / 2;
    const centreY = Math.floor(polygon / columns) * cell + cell / 2;
    const turn = 0.3 + (polygon % 7) * 0.1;
    const reach = radius * (0.9 + (polygon % 5) * 0.04);
    for (let side = 0; side < sides; side++) {
      const angle = (side / sides) * Math.PI * 2 + turn;
      positions[(polygon * sides + side) * 2] = centreX + Math.cos(angle) * reach;
      positions[(polygon * sides + side) * 2 + 1] = centreY + Math.sin(angle) * reach;
    }
    starts[polygon + 1] = (polygon + 1) * sides;
    colors.set([(polygon * 37) % 256, (polygon * 91) % 256, 160, 255], polygon * 4);
  }
  return { positions, starts, colors };
}

function nextFrame(deck: Deck<OrthographicView>): Promise<void> {
  return new Promise<void>((resolve) => {
    deck.setProps({ onAfterRender: () => resolve() });
  });
}

interface Updatable {
  updateState: (this: unknown, ...parameters: unknown[]) => unknown;
}

const timedUpdates: number[] = [];
const polygonLayer = SolidPolygonLayer.prototype as unknown as Updatable;
const stockUpdate = polygonLayer.updateState;
polygonLayer.updateState = function timedUpdate(this: unknown, ...parameters: unknown[]) {
  const started = performance.now();
  const result = stockUpdate.apply(this, parameters);
  timedUpdates.push(performance.now() - started);
  return result;
};

let previous: { deck: Deck<OrthographicView>; canvas: HTMLCanvasElement } | null = null;

async function run(polygons: number, mode: TriangulationMode): Promise<IndicesReport> {
  if (previous) disposeDeck(previous.deck, previous.canvas);
  previous = null;
  const canvas = document.createElement("canvas");
  canvas.id = "scene";
  canvas.style.width = `${viewSize}px`;
  canvas.style.height = `${viewSize}px`;
  canvas.style.display = "block";
  document.body.append(canvas);

  const flat = octagons(polygons);
  const startedBatch = performance.now();
  const batch = createPolygonBatch(flat);
  const batchMs = performance.now() - startedBatch;

  let ready: () => void = () => {};
  const initialised = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const deck = new Deck<OrthographicView>({
    canvas,
    deviceProps: deckDeviceProps,
    views: new OrthographicView({ id: "scene", controller: false }),
    viewState: {
      target: [world / 2, world / 2, 0],
      zoom: Math.log2(cellPixels / cellSize(polygons)),
    },
    width: viewSize,
    height: viewSize,
    useDevicePixels: 1,
    layers: [],
    onAfterRender: () => ready(),
  });
  await initialised;
  previous = { deck, canvas };

  const data = polygonFillData(batch);
  const withoutIndices = {
    getPolygon: data.attributes.getPolygon,
    getFillColor: data.attributes.getFillColor,
  };
  const layer = new SolidPolygonLayer({
    id: `polygons-${mode}`,
    data: mode === "precomputed" ? data : { ...data, attributes: withoutIndices },
    _normalize: false,
    positionFormat: "XY",
    filled: true,
    extruded: false,
    ...unpickableLayerProps,
  } as never);

  const rendered = nextFrame(deck);
  timedUpdates.length = 0;
  const startedUpdate = performance.now();
  deck.setProps({ layers: [layer] });
  await rendered;
  const updateMs = timedUpdates.reduce((sum, value) => sum + value, 0);
  const frameMs = performance.now() - startedUpdate;
  return { polygons, vertices: polygons * sides, batchMs, updateMs, frameMs };
}

window.indicesHarness = { run };
