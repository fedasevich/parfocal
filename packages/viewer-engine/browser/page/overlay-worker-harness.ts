import { Deck, OrthographicView } from "@deck.gl/core";
import { SolidPolygonLayer } from "@deck.gl/layers";
import { createPolygonBatch, createPolygonBatchInWorker } from "../../src/index.ts";
import { polygonFillData } from "../../src/overlay/deck/binary-data.ts";
import { deckDeviceProps, unpickableLayerProps } from "../../src/viv/deck-settings.ts";

export type PrepareMode = "main" | "worker";

export interface PrepareReport {
  readonly polygons: number;
  readonly triangles: number;
  readonly prepareMs: number;
  readonly longestTaskMs: number;
  readonly longTaskEntries: number;
}

export interface WorkerHarness {
  run(polygons: number, mode: PrepareMode): Promise<PrepareReport>;
}

declare global {
  interface Window {
    workerHarness: WorkerHarness;
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

function watchMainThread(): () => { longestTaskMs: number; longTaskEntries: number } {
  let longest = 0;
  let entries = 0;
  let last = performance.now();
  let running = true;
  const channel = new MessageChannel();
  channel.port1.onmessage = () => {
    const now = performance.now();
    longest = Math.max(longest, now - last);
    last = now;
    if (running) channel.port2.postMessage(0);
  };
  const observer = new PerformanceObserver((list) => {
    entries += list.getEntries().length;
  });
  observer.observe({ type: "longtask", buffered: false });
  channel.port2.postMessage(0);
  return () => {
    running = false;
    const now = performance.now();
    longest = Math.max(longest, now - last);
    observer.disconnect();
    channel.port1.close();
    channel.port2.close();
    return { longestTaskMs: longest, longTaskEntries: entries };
  };
}

async function run(polygons: number, mode: PrepareMode): Promise<PrepareReport> {
  const flat = octagons(polygons);
  await new Promise<void>((resolve) => setTimeout(resolve, 200));
  const stop = watchMainThread();
  const started = performance.now();
  const batch =
    mode === "worker" ? await createPolygonBatchInWorker(flat) : createPolygonBatch(flat);
  const prepareMs = performance.now() - started;
  await new Promise<void>((resolve) => setTimeout(resolve, 50));
  const watched = stop();

  const canvas = document.createElement("canvas");
  canvas.id = "scene";
  canvas.style.width = `${viewSize}px`;
  canvas.style.height = `${viewSize}px`;
  canvas.style.display = "block";
  document.body.append(canvas);
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
  const rendered = new Promise<void>((resolve) => {
    deck.setProps({ onAfterRender: () => resolve() });
  });
  deck.setProps({
    layers: [
      new SolidPolygonLayer({
        id: `polygons-${mode}`,
        data: polygonFillData(batch),
        _normalize: false,
        positionFormat: "XY",
        filled: true,
        extruded: false,
        ...unpickableLayerProps,
      } as never),
    ],
  });
  await rendered;
  return {
    polygons,
    triangles: batch.indices.length / 3,
    prepareMs,
    longestTaskMs: watched.longestTaskMs,
    longTaskEntries: watched.longTaskEntries,
  };
}

window.workerHarness = { run };
