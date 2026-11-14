import { performance } from "node:perf_hooks";
import { createPolygonBatch, createVectorOverlay, type ViewRect } from "../../src/index.ts";
import { createOverlayLayerBuilder } from "../../src/overlay/deck/overlay-layers.ts";

class FakeImageData {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;

  constructor(data: Uint8ClampedArray, width: number, height: number) {
    this.data = data;
    this.width = width;
    this.height = height;
  }
}

Object.assign(globalThis, { ImageData: FakeImageData });

const perRow = 1265;
const count = perRow * perRow;
const pitch = 20;
const side = 6;
const pixelsPerUnit = 20 / Math.hypot(side, side);
const viewWidth = 1920 / pixelsPerUnit;
const viewHeight = 1080 / pixelsPerUnit;

function timed<T>(label: string, run: () => T): T {
  const from = performance.now();
  const result = run();
  console.log(`${label}: ${(performance.now() - from).toFixed(1)} ms`);
  return result;
}

function viewAt(x: number, y: number): ViewRect {
  return [x, y, x + viewWidth, y + viewHeight];
}

function drawn(layers: readonly unknown[]): number {
  const first = layers[0] as { props: { data: { length: number } } } | undefined;
  return first?.props.data.length ?? 0;
}

const overlay = timed("batch with earcut", () => {
  const positions = new Float32Array(count * 8);
  const starts = new Uint32Array(count + 1);
  const colors = new Uint8Array(count * 4).fill(255);
  for (let shape = 0; shape < count; shape++) {
    const x = (shape % perRow) * pitch;
    const y = Math.floor(shape / perRow) * pitch;
    positions.set([x, y, x + side, y, x + side, y + side, x, y + side], shape * 8);
    starts[shape + 1] = (shape + 1) * 4;
  }
  return createVectorOverlay({
    id: "n",
    kind: "nuclei",
    shapes: { polygons: createPolygonBatch({ positions, starts, colors }) },
  });
});

const builder = createOverlayLayerBuilder();
const centre = (perRow * pitch) / 2;
console.log(`shapes: ${count}`);
const first = timed("first build with a view (stats, grid, first window)", () =>
  builder.build([overlay], pixelsPerUnit, viewAt(centre, centre)),
);
console.log(`shapes drawn in the window: ${drawn(first)}`);
timed("pan inside the window (key check and build)", () => {
  builder.lodKey([overlay], pixelsPerUnit, viewAt(centre + 40, centre + 40));
  return builder.build([overlay], pixelsPerUnit, viewAt(centre + 40, centre + 40));
});
const rebuilds: number[] = [];
for (let step = 1; step <= 20; step++) {
  const view = viewAt(centre + step * viewWidth, centre + (step % 5) * viewHeight);
  const from = performance.now();
  builder.build([overlay], pixelsPerUnit, view);
  rebuilds.push(performance.now() - from);
}
rebuilds.sort((a, b) => a - b);
console.log(
  `window rebuild after leaving it, 20 runs: median ${rebuilds[10]?.toFixed(1)} ms, max ${rebuilds[19]?.toFixed(1)} ms`,
);
console.log(`heap used: ${(process.memoryUsage().heapUsed / 2 ** 20).toFixed(0)} MB`);
console.log(`array buffers: ${(process.memoryUsage().arrayBuffers / 2 ** 20).toFixed(0)} MB`);
