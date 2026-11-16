import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createViewMap,
  decodePaintedMap,
  encodePaintedMap,
  PaintedMapFormatError,
  paintedCellCount,
  paintedMapHeaderBytes,
  paintViewMap,
  type ViewMap,
  viewMapGrid,
  viewMapLayout,
  viewMapTileId,
} from "../../src/index.ts";

const layout = viewMapLayout({ width: 10_000, height: 6_000 }, 100, 10);
const blank = () => createViewMap(layout);

const cellAt = (map: ViewMap, column: number, row: number): number => {
  const tile = map.tiles.get(
    viewMapTileId({ column: Math.floor(column / 10), row: Math.floor(row / 10) }),
  );
  if (tile === undefined) return 0;
  return tile.values[(row % 10) * tile.width + (column % 10)] ?? 0;
};

test("a dab paints the cells whose centres lie under the brush", () => {
  const map = paintViewMap(blank(), {
    points: [{ x: 550, y: 550 }],
    diameter: 220,
    mode: "paint",
    value: 200,
  });
  assert.equal(cellAt(map, 5, 5), 200);
  assert.equal(cellAt(map, 4, 5), 200);
  assert.equal(cellAt(map, 6, 5), 200);
  assert.equal(cellAt(map, 4, 4), 0);
  assert.equal(paintedCellCount(map), 5);
  assert.equal(map.tiles.size, 1);
});

test("a thin brush still paints the cell under each point", () => {
  const map = paintViewMap(blank(), { points: [{ x: 10, y: 10 }], diameter: 4, mode: "paint" });
  assert.equal(cellAt(map, 0, 0), 255);
  assert.equal(paintedCellCount(map), 1);
});

test("a stroke across a tile edge paints both tiles and leaves the rest unpainted", () => {
  const map = paintViewMap(blank(), {
    points: [
      { x: 850, y: 450 },
      { x: 1_250, y: 450 },
    ],
    diameter: 100,
    mode: "paint",
  });
  assert.deepEqual([...map.tiles.keys()].sort(), ["0,0", "1,0"]);
  for (let column = 8; column <= 12; column++) assert.equal(cellAt(map, column, 4), 255);
  assert.equal(cellAt(map, 7, 4), 0);
  const grid = viewMapGrid(map);
  assert.ok(grid);
  assert.equal(grid.width, 20);
  assert.equal(grid.values[grid.width * 4 + 10], 1);
});

test("erasing clears cells and drops a tile once it is empty", () => {
  const painted = paintViewMap(blank(), {
    points: [{ x: 50, y: 50 }],
    diameter: 10,
    mode: "paint",
  });
  const erased = paintViewMap(painted, { points: [{ x: 50, y: 50 }], diameter: 10, mode: "erase" });
  assert.equal(erased.tiles.size, 0);
  assert.equal(
    paintViewMap(blank(), { points: [{ x: 50, y: 50 }], diameter: 10, mode: "erase" }).tiles.size,
    0,
  );
});

test("painting the same value again returns the same map", () => {
  const stroke = { points: [{ x: 50, y: 50 }], diameter: 10, mode: "paint" as const };
  const once = paintViewMap(blank(), stroke);
  assert.equal(paintViewMap(once, stroke), once);
});

test("a painted value outside 1 to 255 and a brush without size are refused", () => {
  const point = [{ x: 50, y: 50 }];
  assert.throws(() =>
    paintViewMap(blank(), { points: point, diameter: 10, mode: "paint", value: 0 }),
  );
  assert.throws(() =>
    paintViewMap(blank(), { points: point, diameter: 10, mode: "paint", value: 256 }),
  );
  assert.throws(() => paintViewMap(blank(), { points: point, diameter: 0, mode: "paint" }));
});

test("a painted map round-trips through its file value for value", () => {
  let map = paintViewMap(blank(), {
    points: [
      { x: 120, y: 80 },
      { x: 3_400, y: 2_900 },
      { x: 9_990, y: 5_990 },
    ],
    diameter: 300,
    mode: "paint",
    value: 180,
  });
  map = paintViewMap(map, { points: [{ x: 2_000, y: 2_000 }], diameter: 500, mode: "erase" });
  const bytes = encodePaintedMap(map);
  const back = decodePaintedMap(bytes);
  assert.deepEqual(back.layout, map.layout);
  assert.deepEqual([...back.tiles.keys()].sort(), [...map.tiles.keys()].sort());
  for (const [id, tile] of map.tiles) assert.deepEqual(back.tiles.get(id)?.values, tile.values);
  assert.equal(paintedCellCount(back), paintedCellCount(map));
  assert.deepEqual(encodePaintedMap(back), bytes);
});

test("the file layout is the one the API reads", () => {
  const small = createViewMap(viewMapLayout({ width: 1_000, height: 600 }, 100, 4));
  const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
  assert.equal(
    hex(encodePaintedMap(small)),
    "5046504d0100040064000000e803000058020000" + "00000000",
  );
  const one = encodePaintedMap(
    paintViewMap(small, { points: [{ x: 50, y: 50 }], diameter: 10, mode: "paint" }),
  );
  assert.equal(one.length, 24 + 4 + 16);
  assert.equal(hex(one.subarray(20, 28)), "0100000000000000");
  assert.equal(one[28], 255);
});

test("an empty painted map is only a header", () => {
  const bytes = encodePaintedMap(blank());
  assert.equal(bytes.length, paintedMapHeaderBytes);
  assert.equal(decodePaintedMap(bytes).tiles.size, 0);
});

test("a damaged painted map file is refused", () => {
  const good = encodePaintedMap(
    paintViewMap(blank(), { points: [{ x: 50, y: 50 }], diameter: 10, mode: "paint" }),
  );
  assert.throws(() => decodePaintedMap(good.subarray(0, 10)), PaintedMapFormatError);
  assert.throws(() => decodePaintedMap(good.subarray(0, good.length - 1)), PaintedMapFormatError);
  const extra = new Uint8Array(good.length + 1);
  extra.set(good);
  assert.throws(() => decodePaintedMap(extra), PaintedMapFormatError);
  const wrongMagic = good.slice();
  wrongMagic[0] = 0x58;
  assert.throws(() => decodePaintedMap(wrongMagic), PaintedMapFormatError);
  const outside = good.slice();
  new DataView(outside.buffer).setUint16(paintedMapHeaderBytes, 40, true);
  assert.throws(() => decodePaintedMap(outside), PaintedMapFormatError);
});
