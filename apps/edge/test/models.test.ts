import assert from "node:assert/strict";
import { test } from "node:test";
import worker, { type EdgeEnv } from "../src/index.ts";
import { MODEL_CACHE_CONTROL, modelKey } from "../src/models.ts";

const SECRET = btoa("k".repeat(32));
const BYTES = new Uint8Array([8, 7, 18, 4, 1, 2, 3, 4]);

type Stored = Record<string, { bytes: Uint8Array; etag: string }>;

function bucket(stored: Stored, reads: string[]): R2Bucket {
  const meta = (key: string) => {
    const entry = stored[key];
    return entry === undefined
      ? null
      : { key, size: entry.bytes.length, httpEtag: `"${entry.etag}"`, etag: entry.etag };
  };
  return {
    head: (key: string) => Promise.resolve(meta(key)),
    get: (key: string, options?: { onlyIf?: Headers }) => {
      reads.push(key);
      const found = meta(key);
      const entry = stored[key];
      if (found === null || entry === undefined) return Promise.resolve(null);
      if (options?.onlyIf?.get("If-None-Match") === found.httpEtag) return Promise.resolve(found);
      return Promise.resolve({ ...found, body: new Blob([entry.bytes]).stream() });
    },
  } as unknown as R2Bucket;
}

function envWith(slides: R2Bucket): EdgeEnv {
  return {
    SLIDES: slides,
    TILE_TOKEN_KEY: SECRET,
    ROOMS: {} as DurableObjectNamespace,
    ROOM_TOKEN_KEY: SECRET,
    LOCAL_RUN: "true",
  };
}

const stored: Stored = { "models/pathosam.decoder.onnx": { bytes: BYTES, etag: "v1" } };

async function fetchModel(path: string, init: RequestInit = {}, reads: string[] = []) {
  return worker.fetch(
    new Request(`https://parfocal.test${path}`, init),
    envWith(bucket(stored, reads)),
  );
}

test("a model file is served from the models prefix of the bucket", async () => {
  const reads: string[] = [];
  const response = await fetchModel("/models/pathosam.decoder.onnx", {}, reads);
  assert.equal(response.status, 200);
  assert.deepEqual(reads, ["models/pathosam.decoder.onnx"]);
  assert.equal(response.headers.get("Content-Type"), "application/octet-stream");
  assert.equal(response.headers.get("Content-Length"), String(BYTES.length));
  assert.equal(response.headers.get("ETag"), '"v1"');
  assert.equal(response.headers.get("Cache-Control"), MODEL_CACHE_CONTROL);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), BYTES);
});

test("a matching ETag answers 304 so the browser keeps its cached model", async () => {
  const response = await fetchModel("/models/pathosam.decoder.onnx", {
    headers: { "If-None-Match": '"v1"' },
  });
  assert.equal(response.status, 304);
  assert.equal(response.headers.get("ETag"), '"v1"');
});

test("HEAD answers the size without a body", async () => {
  const response = await fetchModel("/models/pathosam.decoder.onnx", { method: "HEAD" });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Length"), String(BYTES.length));
});

test("a missing model is a 404 problem, not the app page", async () => {
  const response = await fetchModel("/models/pathosam.encoder_q4.onnx");
  assert.equal(response.status, 404);
  assert.equal(response.headers.get("Content-Type"), "application/problem+json");
});

test("only plain onnx file names under /models/ reach the bucket", async () => {
  const reads: string[] = [];
  for (const path of ["/models/", "/models/../t/x.onnx", "/models/a/b.onnx", "/models/x.bin"]) {
    const response = await fetchModel(path, {}, reads);
    assert.equal(response.status, 404, path);
  }
  assert.deepEqual(reads, []);
  assert.equal(
    modelKey("/models/pathosam.ais_decoder_int8_weights.onnx"),
    "models/pathosam.ais_decoder_int8_weights.onnx",
  );
});

test("writes to a model path are refused", async () => {
  const response = await fetchModel("/models/pathosam.decoder.onnx", { method: "PUT", body: "x" });
  assert.equal(response.status, 405);
});
