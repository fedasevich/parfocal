import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { developerRoutePaths } from "../vite/dev-tools.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const fakeApiMarkers = [
  "mockServiceWorker",
  "[MSW]",
  "*/api/health",
  "fake-data-badge",
  "Lenka Mal",
];
const quotes = ['"', "'", "`"];
const developerRouteMarkers = [...developerRoutePaths];

function holds(content: string, marker: string): boolean {
  if (!marker.startsWith("/")) return content.includes(marker);
  return quotes.some((quote) => content.includes(`${quote}${marker}`));
}

type BuildEnv = { appEnv: string; devTools?: "on" };

async function buildFor({ appEnv, devTools }: BuildEnv): Promise<Map<string, string>> {
  const outDir = await mkdtemp(join(tmpdir(), "web-bundle-"));
  process.env["PARFOCAL_PUBLIC_APP_ENV"] = appEnv;
  process.env["PARFOCAL_PUBLIC_FAKE_API"] = "all";
  if (devTools !== undefined) process.env["PARFOCAL_PUBLIC_DEV_TOOLS"] = devTools;
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
    delete process.env["PARFOCAL_PUBLIC_DEV_TOOLS"];
    await rm(outDir, { recursive: true, force: true });
  }
}

function markersIn(files: Map<string, string>, markers: readonly string[]): string[] {
  const found = new Set<string>();
  for (const [name, content] of files) {
    for (const marker of markers) {
      if (name.includes(marker) || holds(content, marker)) found.add(marker);
    }
  }
  return [...found];
}

for (const appEnv of ["dev", "staging", "prod"]) {
  test(`the ${appEnv} build holds no fake API and no developer route`, async () => {
    const files = await buildFor({ appEnv });
    assert.ok([...files.keys()].some((name) => name.endsWith(".js")));
    assert.deepEqual(markersIn(files, fakeApiMarkers), []);
    assert.deepEqual(markersIn(files, developerRouteMarkers), []);
  });
}

test("the browser test build holds the fake API and every developer route", async () => {
  const files = await buildFor({ appEnv: "dev", devTools: "on" });
  assert.ok(markersIn(files, fakeApiMarkers).includes("mockServiceWorker"));
  assert.deepEqual(
    markersIn(files, developerRouteMarkers).sort(),
    [...developerRouteMarkers].sort(),
  );
});

for (const appEnv of ["staging", "prod"]) {
  test(`a ${appEnv} build refuses the developer tools flag`, async () => {
    await assert.rejects(
      buildFor({ appEnv, devTools: "on" }),
      new RegExp(`PARFOCAL_PUBLIC_DEV_TOOLS must be off in ${appEnv}`),
    );
  });
}
