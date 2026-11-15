import assert from "node:assert/strict";
import { after, afterEach, before, describe, test } from "node:test";
import { paintedMapHandlers, resetFakePaintedMaps } from "@parfocal/api-client/fake";
import { encodePaintedMap, paintedCellCount } from "@parfocal/viewer-engine";
import { setupServer } from "msw/node";
import {
  createPaintedMapSession,
  type PaintedMapSession,
  paintedMapStoreFor,
} from "../src/results/painted-map-session.ts";

const server = setupServer(...paintedMapHandlers());
let patchedFetch: typeof fetch;

before(() => {
  server.listen({ onUnhandledFrame: "error" });
  patchedFetch = globalThis.fetch;
  globalThis.fetch = (input, init) =>
    patchedFetch(new URL(input instanceof Request ? input.url : input, "http://app.test"), init);
});

afterEach(() => resetFakePaintedMaps());

after(() => {
  globalThis.fetch = patchedFetch;
  server.close();
});

const slide = { width: 40_000, height: 30_000 };
const slideId = "slide-painted";

const sessionFor = (id: string = slideId): PaintedMapSession =>
  createPaintedMapSession({ slide, store: paintedMapStoreFor(id) });

const dab = (x: number, y: number, mode: "paint" | "erase" = "paint") => ({
  points: [{ x, y }],
  diameter: 600,
  mode,
});

describe("painting a map", () => {
  test("a stroke paints cells and an erase stroke clears them again", () => {
    const session = sessionFor();
    assert.equal(session.getState().painted, 0);
    session.paint(dab(10_000, 10_000));
    const painted = session.getState().painted;
    assert.ok(painted > 0);
    assert.equal(session.getState().dirty, true);
    session.paint(dab(10_000, 10_000, "erase"));
    assert.equal(session.getState().painted, 0);
  });

  test("a new map starts with the same grid as the view map", () => {
    const state = sessionFor().getState();
    assert.equal(state.map.layout.cell, 256);
    assert.equal(state.map.layout.tileCells, 16);
  });
});

describe("saving, reopening and exporting a map", () => {
  test("the first save creates version one and a second save makes version two", async () => {
    const session = sessionFor();
    session.paint(dab(10_000, 10_000));
    await session.save("Tumor edge");
    const first = session.getState();
    assert.equal(first.phase, "idle");
    assert.equal(first.dirty, false);
    assert.equal(first.current?.version, 1);
    assert.equal(first.maps.length, 1);
    session.paint(dab(20_000, 12_000));
    assert.equal(session.getState().dirty, true);
    await session.save("Tumor edge");
    const second = session.getState();
    assert.equal(second.current?.version, 2);
    assert.deepEqual(
      second.versions.map((item) => item.version),
      [1, 2],
    );
    assert.equal(second.maps.length, 1);
  });

  test("a fresh session lists the saved map and opens it with the same cells", async () => {
    const first = sessionFor();
    first.paint(dab(10_000, 10_000));
    first.paint(dab(12_000, 10_000));
    await first.save("Edge");
    const saved = paintedCellCount(first.getState().map);
    const again = sessionFor();
    await again.refresh();
    const [listed] = again.getState().maps;
    assert.ok(listed);
    assert.equal(listed.name, "Edge");
    assert.equal(listed.painted_cells, saved);
    await again.open(listed.id);
    assert.equal(again.getState().painted, saved);
    assert.equal(again.getState().dirty, false);
    assert.deepEqual(
      encodePaintedMap(again.getState().map),
      encodePaintedMap(first.getState().map),
    );
  });

  test("an older version opens with the cells it had", async () => {
    const session = sessionFor();
    session.paint(dab(10_000, 10_000));
    await session.save("Edge");
    const one = session.getState().painted;
    session.paint(dab(20_000, 12_000));
    await session.save("Edge");
    const two = session.getState().painted;
    assert.ok(two > one);
    const id = session.getState().current?.id;
    assert.ok(id !== undefined);
    await session.open(id, 1);
    assert.equal(session.getState().painted, one);
    assert.equal(session.getState().opened, 1);
    await session.open(id);
    assert.equal(session.getState().painted, two);
  });

  test("export returns the stored file of the opened version", async () => {
    const session = sessionFor();
    assert.equal(await session.exportFile(), null);
    session.paint(dab(10_000, 10_000));
    await session.save("Edge");
    const file = await session.exportFile();
    assert.ok(file !== null);
    assert.match(file.fileName, /^Edge-v1\.pfmap$/);
    assert.deepEqual(file.bytes, encodePaintedMap(session.getState().map));
  });

  test("saving a map someone else changed reports the conflict and keeps the painting", async () => {
    const mine = sessionFor();
    mine.paint(dab(10_000, 10_000));
    await mine.save("Edge");
    const theirs = sessionFor();
    const id = mine.getState().current?.id;
    assert.ok(id !== undefined);
    await theirs.open(id);
    theirs.paint(dab(20_000, 12_000));
    await theirs.save("Edge");
    mine.paint(dab(5_000, 5_000));
    const before = mine.getState().painted;
    await mine.save("Edge");
    assert.equal(mine.getState().phase, "changed");
    assert.equal(mine.getState().painted, before);
    assert.equal(mine.getState().dirty, true);
  });

  test("save as new keeps the old map and adds another", async () => {
    const session = sessionFor();
    session.paint(dab(10_000, 10_000));
    await session.save("Edge");
    await session.saveAsNew("Edge copy");
    const state = session.getState();
    assert.equal(state.maps.length, 2);
    assert.equal(state.current?.name, "Edge copy");
    assert.equal(state.current?.version, 1);
  });

  test("maps of another slide are not listed", async () => {
    const session = sessionFor();
    session.paint(dab(10_000, 10_000));
    await session.save("Edge");
    const other = sessionFor("slide-other");
    await other.refresh();
    assert.equal(other.getState().maps.length, 0);
  });
});
