import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PixelSource } from "../../src/index.ts";
import { createTileFade, createVivLevels } from "../../src/viv/index.ts";

function clocked(durationMs?: number) {
  let time = 5000;
  const fade = createTileFade(() => time, durationMs);
  return {
    fade,
    advance: (ms: number) => {
      time += ms;
    },
  };
}

describe("tile fade", () => {
  it("starts a tile at zero and reaches full opacity after the duration", () => {
    const { fade, advance } = clocked(200);
    const tile = {};
    assert.equal(fade.opacityOf(tile), 0);
    advance(100);
    assert.equal(fade.opacityOf(tile), 0.5);
    advance(500);
    assert.equal(fade.opacityOf(tile), 1);
  });

  it("fades each tile from its own first draw", () => {
    const { fade, advance } = clocked(200);
    const first = {};
    const second = {};
    fade.opacityOf(first);
    advance(100);
    fade.opacityOf(second);
    advance(100);
    assert.equal(fade.opacityOf(first), 1);
    assert.equal(fade.opacityOf(second), 0.5);
  });

  it("stays active until the last fade ends so the deck keeps drawing", () => {
    const { fade, advance } = clocked(200);
    assert.equal(fade.active(), false);
    fade.opacityOf({});
    assert.equal(fade.active(), true);
    advance(199);
    assert.equal(fade.active(), true);
    advance(2);
    assert.equal(fade.active(), false);
  });

  it("shows a tile at once when the duration is zero", () => {
    const { fade } = clocked(0);
    assert.equal(fade.opacityOf({}), 1);
    assert.equal(fade.active(), false);
  });
});

function sourceOf(): PixelSource {
  const levels = [0, 1].map((level) => ({
    downsample: 2 ** level,
    width: 512 >> level,
    height: 256 >> level,
    tileWidth: 256,
    tileHeight: 256,
  }));
  return {
    formatId: "generic-tiff",
    levels,
    tileSize: { width: 256, height: 256 },
    micronsPerPixel: null,
    photometric: "rgb",
    dtype: "uint8",
    channels: ["red", "green", "blue"].map((name) => ({ name, color: null, window: null })),
    getTile: () => Promise.reject(new Error("unused")),
    getRaster: () => Promise.reject(new Error("unused")),
    close: () => {},
  } as unknown as PixelSource;
}

describe("failed tiles", () => {
  it("keeps a failed tile with its slide rectangle until a retry succeeds", async () => {
    let failing = true;
    const { levels, failures, clearFailure } = createVivLevels(sourceOf(), {
      onTileError: () => {},
      read: (region) =>
        failing
          ? Promise.reject(new Error("tile server refused"))
          : Promise.resolve({
              data: new Uint8Array(region.width * region.height * 3),
              width: region.width,
              height: region.height,
            }),
    });
    const base = levels[0];
    assert.ok(base);
    await assert.rejects(base.getTile({ x: 1, y: 0 }));
    assert.deepEqual(failures(), [
      { key: "0/1/0", level: 0, x: 1, y: 0, left: 256, top: 0, width: 256, height: 256 },
    ]);
    failing = false;
    await base.getTile({ x: 1, y: 0 });
    assert.deepEqual(failures(), []);
    failing = true;
    await assert.rejects(base.getTile({ x: 0, y: 0 }));
    clearFailure("0/0/0");
    assert.deepEqual(failures(), []);
  });

  it("does not count an aborted read as a failure", async () => {
    const controller = new AbortController();
    controller.abort();
    const { levels, failures } = createVivLevels(sourceOf(), {
      read: () => Promise.reject(new Error("never reached")),
    });
    const base = levels[0];
    assert.ok(base);
    await assert.rejects(base.getTile({ x: 0, y: 0, signal: controller.signal }));
    assert.deepEqual(failures(), []);
  });
});
