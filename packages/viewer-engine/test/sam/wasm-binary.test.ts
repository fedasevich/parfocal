import assert from "node:assert/strict";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import { loadWasmBinary } from "../../src/sam/wasm-binary.ts";

const wasm = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

function serving(body: Uint8Array, status = 200) {
  return () => Promise.resolve(new Response(body as BodyInit, { status }));
}

test("a plain wasm file is returned as it is", async () => {
  const bytes = await loadWasmBinary("/ort.wasm", serving(wasm));
  assert.deepEqual(new Uint8Array(bytes), wasm);
});

test("a wasm file shipped gzipped is unpacked to the same bytes", async () => {
  const bytes = await loadWasmBinary("/ort.wasm", serving(gzipSync(wasm)));
  assert.deepEqual(new Uint8Array(bytes), wasm);
});

test("a missing wasm file fails with its address", async () => {
  await assert.rejects(
    loadWasmBinary("/ort.wasm", serving(new Uint8Array(), 404)),
    /\/ort\.wasm: 404/,
  );
});
