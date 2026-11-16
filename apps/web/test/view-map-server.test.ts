import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { getScoreViewMapTileUrl } from "@parfocal/api-client";
import { viewMapLayout, viewMapTileRequest } from "@parfocal/viewer-engine";
import {
  postViewTile,
  type ViewTilePost,
  viewMapScorerFor,
  viewMapSourceOf,
} from "../src/results/view-map-scorer.ts";
import { createViewMapSession } from "../src/results/view-map-session.ts";

const slide = { width: 40_000, height: 30_000 };
const slideId = "00000000-0000-4000-8005-000000000005";
const view = { x: 8_000, y: 8_000, width: 6_000, height: 4_000 };
const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

function serverRecorder() {
  const asked: { slideId: string; column: number; row: number }[] = [];
  const post: ViewTilePost = (id, column, row) => {
    asked.push({ slideId: id, column, row });
    const { width, height } = viewMapTileRequest(viewMapLayout(slide), { column, row });
    return Promise.resolve(new Uint8Array(width * height).fill(200));
  };
  return { asked, post };
}

test("outside the fake API the panel maps the view with the server scorer", async () => {
  assert.equal(viewMapSourceOf({ fakeApi: "off", devTools: true }), "server");
  assert.equal(viewMapSourceOf({ fakeApi: "off", devTools: false }), "server");
  assert.equal(viewMapSourceOf({ fakeApi: "all", devTools: true }), "fake");
  assert.equal(viewMapSourceOf({ fakeApi: "all", devTools: false }), null);

  const { asked, post } = serverRecorder();
  const scorer = viewMapScorerFor("server", slide, slideId, post);
  assert.ok(scorer !== null);
  const session = createViewMapSession({ slide, scorer });
  await session.ask(view);
  const state = session.getState();
  assert.equal(state.phase, "ready");
  assert.equal(state.map.tiles.size, asked.length);
  assert.ok(asked.length > 0);
  assert.ok(asked.every((call) => call.slideId === slideId));
  assert.ok(state.grid?.values.some((value) => Math.abs(value - 200 / 255) < 1e-6));
});

test("a server tile of the wrong size or a refused call fails the panel", async () => {
  const short: ViewTilePost = () => Promise.resolve(new Uint8Array(3));
  const shortScorer = viewMapScorerFor("server", slide, slideId, short);
  assert.ok(shortScorer !== null);
  const shortSession = createViewMapSession({ slide, scorer: shortScorer });
  await shortSession.ask(view);
  assert.equal(shortSession.getState().phase, "failed");

  globalThis.fetch = () => Promise.resolve(new Response(null, { status: 403 }));
  const refusedScorer = viewMapScorerFor("server", slide, slideId);
  assert.ok(refusedScorer !== null);
  const refusedSession = createViewMapSession({ slide, scorer: refusedScorer });
  await refusedSession.ask(view);
  assert.equal(refusedSession.getState().phase, "failed");
});

test("the server call posts to the view map route and reads the cell bytes", async () => {
  const calls: { url: string; method: string | undefined }[] = [];
  globalThis.fetch = (input, init) => {
    calls.push({
      url: input instanceof Request ? input.url : input.toString(),
      method: init?.method,
    });
    return Promise.resolve(new Response(new Uint8Array([1, 2, 3])));
  };
  const values = await postViewTile(slideId, 2, 3);
  assert.deepEqual([...values], [1, 2, 3]);
  assert.deepEqual(calls, [{ url: getScoreViewMapTileUrl(slideId, 2, 3), method: "POST" }]);
});
