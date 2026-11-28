import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type Box,
  boxesCover,
  type DrawnLayer,
  type DrawnTile,
  opaqueTileBoxes,
  partOverSlide,
} from "../../src/viv/tile-cover.ts";

const view: Box = [100, 100, 300, 200];

const leaf = (image: object | null, tileId: unknown = { x: 0, y: 0, z: 0 }): DrawnLayer => ({
  id: "leaf",
  isComposite: false,
  isLoaded: true,
  props: { image, tileId },
});

const wrapper = (inner: readonly DrawnLayer[], isLoaded = true): DrawnLayer => ({
  id: "wrapper",
  isComposite: true,
  isLoaded,
  props: {},
  getSubLayers: () => inner,
});

const tile = (left: number, top: number, changes: Partial<DrawnTile> = {}): DrawnTile => ({
  isLoaded: true,
  index: { z: 0 },
  bbox: { left, top },
  content: { width: 256, height: 256 },
  layers: [wrapper([leaf({})])],
  ...changes,
});

const tiled = (tiles: readonly DrawnTile[] | null) => ({
  state: { tileset: { selectedTiles: tiles } },
});

const allOpaque = { opaque: () => true };

describe("tile cover", () => {
  it("is covered when the boxes fill the whole view", () => {
    assert.equal(
      boxesCover(view, [
        [0, 0, 200, 256],
        [200, 0, 456, 256],
      ]),
      true,
    );
  });

  it("is not covered when a strip of the view is left open", () => {
    assert.equal(boxesCover(view, [[0, 0, 299, 256]]), false);
    assert.equal(boxesCover(view, [[0, 0, 512, 199]]), false);
    assert.equal(boxesCover(view, []), false);
  });

  it("is never covered for an empty view", () => {
    assert.equal(boxesCover([10, 10, 10, 50], [[0, 0, 100, 100]]), false);
  });

  it("keeps only the part of the view that lies over the slide", () => {
    assert.deepEqual(partOverSlide(view, 300, 200), view);
    assert.deepEqual(partOverSlide(view, 299, 150), [100, 100, 299, 150]);
    assert.deepEqual(partOverSlide([-236, -57, 1204, 843], 1024, 768), [0, 0, 1024, 768]);
    assert.equal(partOverSlide([-50, 0, 0, 10], 300, 200), null);
    assert.equal(partOverSlide([300, 0, 400, 10], 300, 200), null);
  });

  it("counts tiles that end at the slide edge as covering a view that overhangs it", () => {
    const shown = partOverSlide([-100, -100, 400, 300], 300, 200);
    assert.ok(shown !== null);
    assert.equal(
      boxesCover(shown, [
        [0, 0, 256, 200],
        [256, 0, 300, 200],
      ]),
      true,
    );
    assert.equal(boxesCover(shown, [[0, 0, 256, 200]]), false);
  });

  it("gives each loaded tile the box its image is drawn into", () => {
    const boxes = opaqueTileBoxes(
      tiled([tile(0, 0), tile(512, 0, { content: { width: 100, height: 60 } })]),
      allOpaque,
    );
    assert.deepEqual(boxes, [
      [0, 0, 256, 256],
      [512, 0, 612, 60],
    ]);
  });

  it("scales a coarser tile by its level", () => {
    assert.deepEqual(opaqueTileBoxes(tiled([tile(512, 0, { index: { z: -2 } })]), allOpaque), [
      [512, 0, 1536, 1024],
    ]);
  });

  it("has no answer while any tile is missing, loading, empty or undrawn", () => {
    const cases: Partial<DrawnTile>[] = [
      { isLoaded: false },
      { content: null },
      { content: { width: 0, height: 256 } },
      { layers: null },
      { layers: [] },
      { layers: [wrapper([leaf({})], false)] },
      { layers: [wrapper([])] },
      { layers: [wrapper([leaf(null)])] },
      { layers: [wrapper([{ ...leaf({}), props: { image: {} } }])] },
      { bbox: {} },
    ];
    for (const changes of cases) {
      assert.equal(opaqueTileBoxes(tiled([tile(0, 0), tile(256, 0, changes)]), allOpaque), null);
    }
  });

  it("has no answer while a tile is still fading in", () => {
    const fading = {};
    const fade = { opaque: (image: object) => image !== fading };
    assert.equal(
      opaqueTileBoxes(tiled([tile(0, 0, { layers: [wrapper([leaf(fading)])] })]), fade),
      null,
    );
    assert.notEqual(opaqueTileBoxes(tiled([tile(0, 0)]), fade), null);
    assert.notEqual(opaqueTileBoxes(tiled([tile(0, 0)]), undefined), null);
  });

  it("has no answer without selected tiles or with tiles of mixed levels", () => {
    assert.equal(opaqueTileBoxes(tiled(null), allOpaque), null);
    assert.equal(opaqueTileBoxes(tiled([]), allOpaque), null);
    assert.equal(opaqueTileBoxes({}, allOpaque), null);
    assert.equal(
      opaqueTileBoxes(tiled([tile(0, 0), tile(256, 0, { index: { z: -1 } })]), allOpaque),
      null,
    );
  });
});
