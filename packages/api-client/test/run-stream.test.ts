import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import { setupServer } from "msw/node";
import {
  annotateTaskSlides,
  fakeApiHandlers,
  resetFakeRunStreams,
  resetFakeSharedLayer,
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

const annotateTask = "00000000-0000-4000-8007-000000000021";

test("a selection run of an annotate task streams only its tiles and joins as AI objects", async () => {
  setFakeViewerScene("streaming");
  resetFakeSharedLayer();
  const byHand = annotateTaskSlides.byHand;
  const started = await fetch(`/api/projects/${project}/model-runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      slide_ids: [byHand],
      task_id: annotateTask,
      scope: {
        kind: "selection",
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [600, 100],
              [760, 100],
              [760, 240],
              [600, 240],
              [600, 100],
            ],
          ],
        },
      },
      parameters: { detector: { name: "hovernet" } },
    }),
  });
  const [run] = (await started.json()) as {
    id: string;
    task_id: string;
    scope: { kind: string };
    result_set_id: string;
  }[];
  if (run === undefined) throw new Error("No run started");
  assert.equal(run.task_id, annotateTask);
  assert.equal(run.scope.kind, "selection");

  const streamed = await areas(run.id, 0);
  assert.equal(streamed.total, 1);
  assert.deepEqual(
    streamed.areas.map((area) => [area.unit, area.objects]),
    [[1, 4]],
  );
  const done = (await (await fetch(`/api/projects/${project}/model-runs/${run.id}`)).json()) as {
    status: string;
    result_set_id: string;
  };
  assert.equal(done.status, "done");

  const base = `/api/review-tasks/${annotateTask}/slides/${byHand}`;
  const joined = await fetch(`${base}/runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ result_set_id: done.result_set_id }),
  });
  assert.deepEqual(
    ((await joined.json()) as { result_set_id: string; run_set_ids: string[] }).run_set_ids,
    [],
  );
  const ai = (await (await fetch(`${base}/shared-layer/ai`)).json()) as {
    result_set_id: string;
    objects: { object: string }[];
  };
  assert.equal(ai.result_set_id, done.result_set_id);
  assert.deepEqual(
    ai.objects.map((item) => item.object),
    ["C44", "C45", "C50", "C51"],
  );
  const fixed = await fetch(`${base}/shared-layer/ai/C44`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ deleted: true }),
  });
  assert.equal(fixed.status, 201);
  assert.equal(((await fixed.json()) as { origin: string }).origin, "ai-edited");
  resetFakeSharedLayer();
});
