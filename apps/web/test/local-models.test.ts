import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createServer } from "vite";
import { noAppPageForMissingData } from "../vite/data-paths.ts";
import { localModels, localModelsDir } from "../vite/local-models.ts";

const bytes = new Uint8Array([8, 7, 18, 4, 1, 2, 3]);

async function withModels(check: (origin: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "local-models-"));
  const models = join(root, "cache");
  await mkdir(models, { recursive: true });
  await writeFile(join(root, "index.html"), "<!doctype html><title>app</title>");
  await writeFile(join(models, "pathosam.decoder.onnx"), bytes);
  const server = await createServer({
    root,
    configFile: false,
    logLevel: "silent",
    server: { port: 0, host: "127.0.0.1" },
    plugins: [localModels(() => models), noAppPageForMissingData()],
  });
  try {
    await server.listen();
    const address = server.httpServer?.address() as AddressInfo;
    await check(`http://127.0.0.1:${address.port}`);
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
}

test("dev serves the model files exported into the local models cache", async () => {
  await withModels(async (origin) => {
    const response = await fetch(`${origin}/models/pathosam.decoder.onnx`);
    assert.equal(response.status, 200);
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
    const etag = response.headers.get("ETag") ?? "";
    const again = await fetch(`${origin}/models/pathosam.decoder.onnx`, {
      headers: { "If-None-Match": etag },
    });
    assert.equal(again.status, 304);
  });
});

test("a model missing from the cache stays a 404 problem", async () => {
  await withModels(async (origin) => {
    for (const path of ["/models/pathosam.encoder_q4.onnx", "/models/a/b.onnx"]) {
      const response = await fetch(`${origin}${path}`);
      assert.equal(response.status, 404, path);
    }
  });
});

test("the models cache follows PARFOCAL_MODELS_DIR, then XDG_CACHE_HOME", () => {
  assert.equal(localModelsDir({ PARFOCAL_MODELS_DIR: "/m" }), join("/m", "onnx"));
  assert.equal(localModelsDir({ XDG_CACHE_HOME: "/c" }), join("/c", "parfocal", "models", "onnx"));
});
