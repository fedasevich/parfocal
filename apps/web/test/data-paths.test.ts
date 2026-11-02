import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createServer } from "vite";
import { noAppPageForMissingData } from "../vite/data-paths.ts";

async function withDevServer(check: (origin: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "data-paths-"));
  await writeFile(join(root, "index.html"), "<!doctype html><title>app</title>");
  await mkdir(join(root, "public", "data", "sample.zarr"), { recursive: true });
  await writeFile(join(root, "public", "data", "sample.zarr", ".zattrs"), "{}");
  const server = await createServer({
    root,
    configFile: false,
    logLevel: "silent",
    server: { port: 0, host: "127.0.0.1" },
    plugins: [noAppPageForMissingData()],
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

test("missing zarr.json and model files are 404 problems, not the app page", async () => {
  await withDevServer(async (origin) => {
    for (const path of [
      "/data/sample.zarr/zarr.json",
      "/models/nuclei.onnx",
      "/tiles/slide/zarr.json",
      "/data/%E0%A4%A",
    ]) {
      const response = await fetch(`${origin}${path}`);
      assert.equal(response.status, 404, path);
      assert.equal(response.headers.get("Content-Type"), "application/problem+json", path);
      const body = (await response.json()) as { code: string };
      assert.equal(body.code, "not-found", path);
    }
  });
});

test("files that exist under a data path are still served", async () => {
  await withDevServer(async (origin) => {
    const response = await fetch(`${origin}/data/sample.zarr/.zattrs`);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "{}");
  });
});

test("other unknown paths still get the app page", async () => {
  await withDevServer(async (origin) => {
    const response = await fetch(`${origin}/projects/unknown`, {
      headers: { Accept: "text/html" },
    });
    assert.equal(response.status, 200);
    assert.match(await response.text(), /<title>app<\/title>/);
  });
});
