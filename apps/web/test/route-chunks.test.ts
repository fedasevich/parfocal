import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { build } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));

interface Built {
  names: string[];
  initial: string[];
  gzipBytes: (name: string) => number;
}

async function buildProd(): Promise<{ built: Built; cleanup: () => Promise<void> }> {
  const outDir = await mkdtemp(join(tmpdir(), "web-chunks-"));
  process.env["PARFOCAL_PUBLIC_APP_ENV"] = "prod";
  try {
    await build({ root, logLevel: "silent", build: { outDir, emptyOutDir: true } });
  } finally {
    delete process.env["PARFOCAL_PUBLIC_APP_ENV"];
  }
  const html = await readFile(join(outDir, "index.html"), "utf8");
  const initial = [...html.matchAll(/(?:src|href)="\/(assets\/[^"]+\.(?:js|css))"/g)].map(
    (match) => match[1] ?? "",
  );
  const names = (await readdir(join(outDir, "assets"))).map((name) => `assets/${name}`);
  const sizes = new Map<string, number>();
  for (const name of initial) {
    sizes.set(name, gzipSync(await readFile(join(outDir, name))).length);
  }
  return {
    built: { names, initial, gzipBytes: (name) => sizes.get(name) ?? 0 },
    cleanup: () => rm(outDir, { recursive: true, force: true }),
  };
}

const splitChunks = [
  "viewer-engine-",
  "projects._projectId.slides._slideId-",
  "guided-review-",
  "admin-",
  "report-screen-",
  "tasks._taskId.evaluation-",
  "my-work-",
  "settings._section-",
  "home-screen-",
];

test("the first page loads no viewer engine and no other route, and stays under the bundle budget", async () => {
  const { built, cleanup } = await buildProd();
  try {
    for (const chunk of splitChunks) {
      assert.ok(
        built.names.some((name) => name.includes(chunk)),
        `no ${chunk} chunk exists, so the route is not split`,
      );
      assert.ok(
        !built.initial.some((name) => name.includes(chunk)),
        `${chunk} is loaded with the first page`,
      );
    }
    for (const name of built.initial) {
      assert.doesNotMatch(name, /zstd|blosc|lz4|openjpeg|lerc/);
    }
    const budget = JSON.parse(await readFile(join(root, "bundle-budget.json"), "utf8")) as {
      initialHomeGzipBytes: number;
    };
    const total = built.initial.reduce((sum, name) => sum + built.gzipBytes(name), 0);
    assert.ok(
      total <= budget.initialHomeGzipBytes,
      `the first page loads ${total} bytes gzip, budget ${budget.initialHomeGzipBytes}`,
    );
  } finally {
    await cleanup();
  }
});
