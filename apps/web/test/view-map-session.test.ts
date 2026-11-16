import assert from "node:assert/strict";
import { test } from "node:test";
import type { ViewMapTileRequest } from "@parfocal/viewer-engine";
import {
  createFakeViewMapScorer,
  fakeTumorProbability,
  fakeTumorSpots,
} from "../src/results/view-map-scorer.ts";
import { createViewMapSession } from "../src/results/view-map-session.ts";

const slide = { width: 40_000, height: 30_000 };
const view = { x: 8_000, y: 8_000, width: 6_000, height: 4_000 };

test("the map extends as the user pans and asks again", async () => {
  const scorer = createFakeViewMapScorer(slide);
  const session = createViewMapSession({ slide, scorer });
  assert.equal(session.getState().phase, "empty");
  await session.ask(view);
  const first = session.getState();
  assert.equal(first.phase, "ready");
  const firstTiles = first.map.tiles.size;
  assert.ok(firstTiles > 0);
  const firstArea = first.grid?.area;
  assert.ok(firstArea !== undefined);
  await session.ask({ ...view, x: view.x + 5_000 });
  const second = session.getState();
  assert.ok(second.map.tiles.size > firstTiles);
  const secondArea = second.grid?.area;
  assert.ok(secondArea !== undefined);
  assert.equal(secondArea.x, firstArea.x);
  assert.ok(secondArea.width > firstArea.width);
  const scoredOnce = new Set(
    scorer.asked.map((request) => `${request.key.column},${request.key.row}`),
  );
  assert.equal(scoredOnce.size, scorer.asked.length);
});

test("asking again for a view already mapped scores nothing", async () => {
  const scorer = createFakeViewMapScorer(slide);
  const session = createViewMapSession({ slide, scorer });
  await session.ask(view);
  const asked = scorer.asked.length;
  const before = session.getState();
  await session.ask(view);
  assert.equal(scorer.asked.length, asked);
  assert.equal(session.getState().grid, before.grid);
});

test("a view too wide to map asks the user to zoom in and keeps the map", async () => {
  const scorer = createFakeViewMapScorer(slide);
  const session = createViewMapSession({ slide, scorer, maxTiles: 4 });
  await session.ask({ x: 0, y: 0, width: slide.width, height: slide.height });
  assert.equal(session.getState().phase, "too-wide");
  assert.equal(scorer.asked.length, 0);
});

test("a scorer that fails leaves the finished tiles and says so", async () => {
  let calls = 0;
  const scorer = (request: ViewMapTileRequest) => {
    calls += 1;
    if (calls > 1) return Promise.reject(new Error("offline"));
    return Promise.resolve(new Uint8Array(request.width * request.height).fill(255));
  };
  const session = createViewMapSession({ slide, scorer });
  const seen: string[] = [];
  session.subscribe(() => seen.push(session.getState().phase));
  await session.ask(view);
  assert.equal(session.getState().phase, "failed");
  assert.equal(session.getState().map.tiles.size, 1);
  assert.equal(seen[0], "scoring");
});

test("the fake scorer peaks on its spots and fades away from them", () => {
  const [spot] = fakeTumorSpots;
  const centre = fakeTumorProbability(slide, spot.x * slide.width, spot.y * slide.height);
  assert.ok(Math.abs(centre - spot.peak) < 1e-9);
  assert.ok(fakeTumorProbability(slide, 0, slide.height) < 0.01);
});
