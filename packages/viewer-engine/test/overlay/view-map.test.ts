import assert from "node:assert/strict";
import { test } from "node:test";
import {
  askViewMap,
  colorizeHeatmap,
  createViewMap,
  defaultHeatmapLook,
  planViewMap,
  type ViewMapTileRequest,
  viewMapCoveredArea,
  viewMapGrid,
  viewMapLayout,
  viewMapTileId,
  viewMapTilesIn,
  withViewMapTile,
} from "../../src/index.ts";

const slide = { width: 10_000, height: 6_000 };
const layout = viewMapLayout(slide, 100, 10);
const span = 1_000;

function recordingScorer(value = 200) {
  const asked: ViewMapTileRequest[] = [];
  const scorer = (request: ViewMapTileRequest) => {
    asked.push(request);
    return Promise.resolve(new Uint8Array(request.width * request.height).fill(value));
  };
  return { asked, scorer };
}

test("the layout splits the slide into whole cells and tiles that cover it", () => {
  const odd = viewMapLayout({ width: 1_050, height: 990 }, 100, 4);
  assert.equal(odd.columns, 11);
  assert.equal(odd.rows, 10);
  assert.equal(odd.tileColumns, 3);
  assert.equal(odd.tileRows, 3);
  assert.throws(() => viewMapLayout(slide, 0));
});

test("only the tiles under the view are wanted, clamped to the slide", () => {
  const keys = viewMapTilesIn(layout, { x: 1_500, y: 500, width: 1_000, height: 400 });
  assert.deepEqual(keys.map(viewMapTileId), ["1,0", "2,0"]);
  const edge = viewMapTilesIn(layout, { x: 9_500, y: 5_500, width: 4_000, height: 4_000 });
  assert.deepEqual(edge.map(viewMapTileId), ["9,5"]);
  assert.deepEqual(viewMapTilesIn(layout, { x: -5_000, y: 0, width: 1_000, height: 1_000 }), []);
});

test("asking for a view scores only that view", async () => {
  const { asked, scorer } = recordingScorer();
  const view = { x: 0, y: 0, width: 2_000, height: 1_000 };
  const map = await askViewMap(createViewMap(layout), view, scorer);
  assert.equal(asked.length, 2);
  assert.deepEqual(viewMapCoveredArea(map), view);
});

test("the map extends as the user pans and asks again, without rescoring", async () => {
  const { asked, scorer } = recordingScorer();
  const first = await askViewMap(
    createViewMap(layout),
    { x: 0, y: 0, width: 2_000, height: 1_000 },
    scorer,
  );
  const panned = { x: 1_000, y: 0, width: 2_000, height: 1_000 };
  assert.deepEqual(planViewMap(first, panned).missing.map(viewMapTileId), ["2,0"]);
  const second = await askViewMap(first, panned, scorer);
  assert.deepEqual(
    asked.map((request) => viewMapTileId(request.key)),
    ["0,0", "1,0", "2,0"],
  );
  assert.equal(first.tiles.size, 2);
  assert.equal(second.tiles.size, 3);
  assert.deepEqual(viewMapCoveredArea(second), { x: 0, y: 0, width: 3 * span, height: span });
  const again = await askViewMap(second, panned, scorer);
  assert.equal(asked.length, 3);
  assert.equal(again.tiles.size, 3);
});

test("the grid keeps unscored cells hidden between two asked views", async () => {
  const { scorer } = recordingScorer(255);
  let map = await askViewMap(
    createViewMap(layout),
    { x: 0, y: 0, width: 999, height: 999 },
    scorer,
  );
  map = await askViewMap(map, { x: 2_000, y: 1_000, width: 999, height: 999 }, scorer);
  const grid = viewMapGrid(map);
  assert.ok(grid !== null);
  assert.equal(grid.width, 30);
  assert.equal(grid.height, 20);
  assert.equal(grid.values[0], 1);
  assert.ok(Number.isNaN(grid.values[15] ?? 0));
  assert.equal(grid.values[10 * 30 + 25], 1);
  const rgba = colorizeHeatmap(grid, defaultHeatmapLook);
  assert.equal(rgba[3], 255);
  assert.equal(rgba[15 * 4 + 3], 0);
  assert.equal(viewMapGrid(createViewMap(layout)), null);
});

test("edge tiles are cut to the slide and the scorer is told their size", async () => {
  const { asked, scorer } = recordingScorer();
  const odd = viewMapLayout({ width: 1_050, height: 990 }, 100, 4);
  const map = await askViewMap(
    createViewMap(odd),
    { x: 900, y: 900, width: 200, height: 200 },
    scorer,
  );
  assert.equal(asked.length, 1);
  assert.deepEqual(asked[0], {
    key: { column: 2, row: 2 },
    width: 3,
    height: 2,
    cell: 100,
    area: { x: 800, y: 800, width: 300, height: 200 },
  });
  assert.equal(map.tiles.size, 1);
});

test("a view wider than the ask limit is refused before any scoring", async () => {
  const { asked, scorer } = recordingScorer();
  const whole = { x: 0, y: 0, width: slide.width, height: slide.height };
  assert.equal(planViewMap(createViewMap(layout), whole, 10).tooWide, true);
  await assert.rejects(askViewMap(createViewMap(layout), whole, scorer, { maxTiles: 10 }));
  assert.equal(asked.length, 0);
});

test("a tile must fit its place on the slide", () => {
  const map = createViewMap(layout);
  assert.throws(() =>
    withViewMapTile(map, {
      key: { column: 10, row: 0 },
      width: 10,
      height: 10,
      values: new Uint8Array(100),
    }),
  );
  assert.throws(() =>
    withViewMapTile(map, {
      key: { column: 0, row: 0 },
      width: 10,
      height: 10,
      values: new Uint8Array(4),
    }),
  );
  const painted = withViewMapTile(map, {
    key: { column: 0, row: 0 },
    width: 10,
    height: 10,
    values: new Uint8Array(100).fill(9),
  });
  assert.equal(painted.tiles.size, 1);
  assert.equal(map.tiles.size, 0);
});
