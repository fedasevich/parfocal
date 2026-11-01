import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const fakeApiMarkers = ["mockServiceWorker", "[MSW]", "*/api/health"];

async function buildFor(appEnv: string): Promise<Map<string, string>> {
  const outDir = await mkdtemp(join(tmpdir(), "web-bundle-"));
  process.env["PARFOCAL_PUBLIC_APP_ENV"] = appEnv;
  process.env["PARFOCAL_PUBLIC_FAKE_API"] = "all";
  try {
    await build({ root, logLevel: "silent", build: { outDir, emptyOutDir: true } });
    const files = new Map<string, string>();
    for (const name of await readdir(outDir, { recursive: true })) {
      if (/\.(js|html|css)$/.test(name))
        files.set(name, await readFile(join(outDir, name), "utf8"));
      else files.set(name, "");
    }
    return files;
  } finally {
    delete process.env["PARFOCAL_PUBLIC_APP_ENV"];
    delete process.env["PARFOCAL_PUBLIC_FAKE_API"];
    await rm(outDir, { recursive: true, force: true });
  }
}

for (const appEnv of ["staging", "prod"]) {
  test(`the ${appEnv} build holds no MSW code even with the fake API flag set`, async () => {
    const files = await buildFor(appEnv);
    assert.ok([...files.keys()].some((name) => name.endsWith(".js")));
    for (const [name, content] of files) {
      assert.doesNotMatch(name, /mockServiceWorker/);
      for (const marker of fakeApiMarkers) {
        assert.ok(!content.includes(marker), `${name} contains ${marker}`);
      }
    }
  });
}
