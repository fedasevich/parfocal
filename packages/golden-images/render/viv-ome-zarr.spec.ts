import { createReadStream, statSync } from "node:fs";
import { join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { syntheticDir } from "@parfocal/test-fixtures";
import { expect, test } from "@playwright/test";
import type { Plugin, ViteDevServer } from "vite";
import { checkGolden } from "../src/index.ts";
import { assertSwiftShader } from "../src/playwright.ts";
import { openHarness, renderVivFrame, startVivHarness } from "./viv-harness.ts";
import type { VivGoldenScene } from "./viv-scenes.ts";

const goldenDirectory = fileURLToPath(new URL("../goldens", import.meta.url));

const scenes: readonly VivGoldenScene[] = [
  {
    name: "viv-synthetic-jpeg-zarr-fit",
    fixture: "synthetic-jpeg.ome.zarr",
    formatId: "ome-zarr",
    format: "ome-zarr-jpeg",
    view: { kind: "fit" },
  },
  {
    name: "viv-synthetic-jpeg-sharded-zarr-fit",
    fixture: "synthetic-jpeg-sharded.ome.zarr",
    formatId: "ome-zarr",
    format: "ome-zarr-jpeg",
    view: { kind: "fit" },
  },
  {
    name: "viv-synthetic-jpeg-converted-zarr-fit",
    fixture: "synthetic-jpeg-converted.ome.zarr",
    formatId: "ome-zarr",
    format: "ome-zarr-jpeg",
    view: { kind: "fit" },
  },
  {
    name: "viv-synthetic-channels-uint16-converted-zarr-fit",
    fixture: "synthetic-channels-uint16-converted.ome.zarr",
    formatId: "ome-zarr",
    format: "ome-zarr",
    view: { kind: "fit" },
  },
];

function fileSize(path: string): number | null {
  try {
    const info = statSync(path);
    return info.isFile() ? info.size : null;
  } catch {
    return null;
  }
}

function storeServer(): Plugin {
  const prefixes = scenes.map((scene) => `/fixtures/${scene.fixture}/`);
  return {
    name: "parfocal-zarr-stores",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://x").pathname);
        if (!prefixes.some((prefix) => pathname.startsWith(prefix))) {
          next();
          return;
        }
        const path = join(syntheticDir, normalize(pathname.slice("/fixtures/".length)));
        const size = path.startsWith(syntheticDir) ? fileSize(path) : null;
        if (size === null) {
          response.writeHead(404);
          response.end();
          return;
        }
        const header = request.headers.range ?? "";
        const suffix = /^bytes=-(\d+)$/.exec(header);
        const span = /^bytes=(\d+)-(\d*)$/.exec(header);
        if (suffix === null && span === null) {
          response.writeHead(200, { "content-length": size, "accept-ranges": "bytes" });
          createReadStream(path).pipe(response);
          return;
        }
        const start = suffix === null ? Number(span?.[1]) : Math.max(0, size - Number(suffix[1]));
        const end = Math.min(span?.[2] ? Number(span[2]) : size - 1, size - 1);
        response.writeHead(206, {
          "content-length": end - start + 1,
          "content-range": `bytes ${start}-${end}/${size}`,
          "accept-ranges": "bytes",
        });
        createReadStream(path, { start, end }).pipe(response);
      });
    },
  };
}

test.describe.configure({ mode: "serial", timeout: 180_000 });

let server: ViteDevServer | null = null;

test.beforeAll(async () => {
  server = await startVivHarness([storeServer()]);
});

test.afterAll(async () => {
  await server?.close();
  server = null;
});

test.beforeEach(async ({ page }) => {
  if (server === null) throw new Error("The Viv harness server did not start");
  await openHarness(page, server);
  await assertSwiftShader(page);
});

for (const scene of scenes) {
  test(`${scene.name} matches its golden image`, async ({ page }, testInfo) => {
    const { result, frame } = await renderVivFrame(page, scene);
    expect(result.errors).toEqual([]);
    expect(result.decoded?.dispatched).toBeGreaterThan(0);
    const outcome = checkGolden(frame, {
      name: scene.name,
      format: scene.format,
      goldenDirectory,
      outputDirectory: testInfo.outputDir,
    });
    if (outcome.status === "mismatched") throw new Error(outcome.message);
  });
}
