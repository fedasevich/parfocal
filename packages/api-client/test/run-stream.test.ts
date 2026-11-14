import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import { setupServer } from "msw/node";
import {
  fakeApiHandlers,
  resetFakeRunStreams,
  setFakeViewerScene,
  streamCellsPerTile,
  streamRunPrefix,
  streamTiles,
} from "../src/fake/index.ts";

const server = setupServer(...fakeApiHandlers("all"));
let patchedFetch: typeof fetch;
const project = "11111111-1111-4111-8111-111111111111";
const slide = "22222222-2222-4222-8222-222222222222";

before(() => {
  server.listen({ onUnhandledFrame: "error" });
  patchedFetch = globalThis.fetch;
  globalThis.fetch = (input, init) =>
    patchedFetch(new URL(input instanceof Request ? input.url : input, "http://app.test"), init);
});

afterEach(() => {
  setFakeViewerScene("ready");
  resetFakeRunStreams();
});

after(() => {
  globalThis.fetch = patchedFetch;
  server.close();
});

async function startRun(): Promise<string> {
  const response = await fetch(`/api/projects/${project}/model-runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      slide_ids: [slide],
      scope: { kind: "slide" },
      parameters: { detector: { name: "hovernet" } },
    }),
  });
  assert.equal(response.status, 201);
  const [run] = (await response.json()) as { id: string }[];
  if (run === undefined) throw new Error("No run started");
  assert.ok(run.id.startsWith(streamRunPrefix));
  return run.id;
}

const areas = async (run: string, after: number) =>
  (await (
    await fetch(`/api/projects/${project}/model-runs/${run}/areas?after=${after}`)
  ).json()) as {
    status: string;
    areas: { unit: number; objects: number }[];
    after: number;
    total: number;
  };

test("a streamed run finishes one tile per read and serves each finished tile", async () => {
  setFakeViewerScene("streaming");
  const run = await startRun();
  const first = await areas(run, 0);
  assert.equal(first.status, "running");
  assert.equal(first.total, streamTiles);
  assert.deepEqual(
    first.areas.map((area) => area.unit),
    [0],
  );
  assert.equal(first.areas[0]?.objects, streamCellsPerTile);
  const tile = await fetch(`/api/projects/${project}/model-runs/${run}/tiles/0`);
  assert.equal(tile.status, 200);
  const bytes = new Uint8Array(await tile.arrayBuffer());
  assert.deepEqual([...bytes.subarray(0, 4)], [0x50, 0x46, 0x43, 0x31]);
  const unfinished = await fetch(`/api/projects/${project}/model-runs/${run}/tiles/5`);
  assert.equal(unfinished.status, 404);
  const second = await areas(run, first.after);
  assert.deepEqual(
    second.areas.map((area) => area.unit),
    [1],
  );
});

test("the slide's running stream run is listed and a finished one is not", async () => {
  setFakeViewerScene("streaming");
  const run = await startRun();
  const listed = async () =>
    (
      (await (
        await fetch(
          `/api/projects/${project}/model-runs?slide_id=${slide}&status=queued&status=running`,
        )
      ).json()) as { id: string }[]
    ).map((item) => item.id);
  assert.deepEqual(await listed(), [run]);
  for (let read = 0; read < streamTiles; read++) await areas(run, 0);
  assert.deepEqual(await listed(), []);
});

test("cancel freezes the finished tiles and the run ends cancelled", async () => {
  setFakeViewerScene("streaming");
  const run = await startRun();
  await areas(run, 0);
  await areas(run, 1);
  const cancelled = await fetch(`/api/projects/${project}/model-runs/${run}/cancel`, {
    method: "POST",
  });
  assert.equal(((await cancelled.json()) as { status: string }).status, "cancelling");
  const draining = await areas(run, 0);
  assert.equal(draining.status, "cancelling");
  assert.equal(draining.areas.length, 2);
  const ended = await areas(run, draining.after);
  assert.equal(ended.status, "cancelled");
  assert.deepEqual(ended.areas, []);
});
