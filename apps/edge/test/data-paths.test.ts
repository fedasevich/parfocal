import assert from "node:assert/strict";
import { test } from "node:test";
import { signCapability, signingKey } from "../src/capability.ts";
import worker, { type EdgeEnv } from "../src/index.ts";

const SECRET = btoa("k".repeat(32));
const TENANT = "11111111-1111-4111-8111-111111111111";
const SLIDE = "33333333-3333-4333-8333-333333333333";

const emptyBucket = {
  get: () => Promise.resolve(null),
  head: () => Promise.resolve(null),
} as unknown as R2Bucket;

const env = {
  SLIDES: emptyBucket,
  TILE_TOKEN_KEY: SECRET,
  ROOMS: {} as DurableObjectNamespace,
  ROOM_TOKEN_KEY: SECRET,
} satisfies EdgeEnv;

async function token(): Promise<string> {
  return signCapability(
    {
      tenant: TENANT,
      slide: SLIDE,
      original: "original.svs",
      size: 10_000,
      restricted: [],
      expires: Math.floor(Date.now() / 1000) + 600,
    },
    await signingKey(SECRET),
  );
}

async function fetchPath(path: string, headers: HeadersInit = {}): Promise<Response> {
  return worker.fetch(
    new Request(`https://parfocal.test${path}`, { headers }),
    env,
    {} as ExecutionContext,
  );
}

async function assertRealNotFound(response: Response, path: string): Promise<void> {
  assert.equal(response.status, 404, path);
  assert.equal(response.headers.get("Content-Type"), "application/problem+json", path);
  const body = (await response.json()) as { code: string };
  assert.equal(body.code, "not-found", path);
}

test("a missing zarr.json of a slide is a 404 problem, not the app page", async () => {
  const path = `/tiles/${SLIDE}/zarr.json`;
  const response = await fetchPath(path, { Authorization: `Bearer ${await token()}` });
  await assertRealNotFound(response, path);
});

test("missing files under the data and model paths are 404 problems, not the app page", async () => {
  for (const path of [
    "/data/sample.zarr/zarr.json",
    "/data/sample.zarr/.zattrs",
    "/models/nuclei.onnx",
    "/models/",
  ]) {
    await assertRealNotFound(await fetchPath(path), path);
  }
});
