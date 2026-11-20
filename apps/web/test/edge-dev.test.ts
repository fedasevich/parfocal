import assert from "node:assert/strict";
import { test } from "node:test";
import {
  customizeEdgeWorker,
  edgeDevFor,
  edgeDevOverrides,
  edgeWorkerPaths,
} from "../vite/edge-dev.ts";

const serve = { command: "serve", isPreview: false } as const;
const keys = { TILE_TOKEN_KEY: "tile", ROOM_TOKEN_KEY: "room" };

test("only the dev server with the flag on runs the edge Worker", () => {
  assert.equal(edgeDevFor({ ...serve, env: {} }), false);
  assert.equal(edgeDevFor({ ...serve, env: { PARFOCAL_EDGE_DEV: "off" } }), false);
  assert.equal(edgeDevFor({ ...serve, env: { PARFOCAL_EDGE_DEV: "on" } }), true);
  assert.equal(
    edgeDevFor({ command: "build", isPreview: false, env: { PARFOCAL_EDGE_DEV: "on" } }),
    false,
  );
  assert.equal(edgeDevFor({ ...serve, isPreview: true, env: { PARFOCAL_EDGE_DEV: "on" } }), false);
});

test("an unknown flag value is refused", () => {
  assert.throws(() => edgeDevFor({ ...serve, env: { PARFOCAL_EDGE_DEV: "yes" } }), /on or off/);
});

test("the dev Worker reads the real bucket remotely and gets the API's token keys", () => {
  const overrides = edgeDevOverrides(
    [{ binding: "SLIDES", bucket_name: "parfocal-dev-eu", jurisdiction: "eu" }],
    keys,
  );
  assert.deepEqual(overrides.r2_buckets, [
    { binding: "SLIDES", bucket_name: "parfocal-dev-eu", jurisdiction: "eu", remote: true },
  ]);
  assert.deepEqual(overrides.vars, keys);
  assert.deepEqual(overrides.assets.run_worker_first, edgeWorkerPaths);
});

test("the dev Worker needs both token keys", () => {
  assert.throws(() => edgeDevOverrides([], { TILE_TOKEN_KEY: "tile" }), /needs ROOM_TOKEN_KEY/);
});

test("the bucket binding is replaced in place, because the plugin concatenates returned arrays", () => {
  const worker = {
    r2_buckets: [{ binding: "SLIDES", bucket_name: "parfocal-dev-eu", jurisdiction: "eu" }],
  };
  const returned = customizeEdgeWorker(worker, keys);
  assert.deepEqual(worker.r2_buckets, [
    { binding: "SLIDES", bucket_name: "parfocal-dev-eu", jurisdiction: "eu", remote: true },
  ]);
  assert.equal("r2_buckets" in returned, false);
  assert.deepEqual(returned.vars, keys);
});
