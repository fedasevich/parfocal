import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";
import { fitAssetsToWorkersLimit, workersAssetLimit } from "../vite/large-assets.ts";

async function withAssets(
  files: Record<string, Uint8Array>,
  check: (dir: string) => Promise<void>,
) {
  const dir = await mkdtemp(join(tmpdir(), "large-assets-"));
  try {
    for (const [name, bytes] of Object.entries(files)) await writeFile(join(dir, name), bytes);
    await check(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const oversized = new Uint8Array(workersAssetLimit + 1);

test("the onnx runtime wasm over the limit is gzipped in place and unpacks to the same bytes", async () => {
  await withAssets({ "ort-wasm-simd-threaded.asyncify-abc.wasm": oversized }, async (dir) => {
    const packed = await fitAssetsToWorkersLimit(dir);
    assert.deepEqual(packed, ["ort-wasm-simd-threaded.asyncify-abc.wasm"]);
    const stored = await readFile(join(dir, packed[0] as string));
    assert.ok(stored.length <= workersAssetLimit);
    assert.deepEqual(new Uint8Array(gunzipSync(stored)), oversized);
  });
});

test("assets within the limit are left alone", async () => {
  const small = new Uint8Array([1, 2, 3]);
  await withAssets({ "ort-wasm-simd-threaded.wasm": small, "app.js": small }, async (dir) => {
    assert.deepEqual(await fitAssetsToWorkersLimit(dir), []);
    assert.deepEqual(new Uint8Array(await readFile(join(dir, "app.js"))), small);
  });
});

test("any other asset over the limit fails the build by name", async () => {
  await withAssets({ "huge.bin": oversized }, async (dir) => {
    await assert.rejects(fitAssetsToWorkersLimit(dir), /huge\.bin/);
  });
});
