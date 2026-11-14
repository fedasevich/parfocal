import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { ViteDevServer } from "vite";
import { checkGolden } from "../src/index.ts";
import { assertSwiftShader } from "../src/playwright.ts";
import { openHarness, renderVivFrame, skipUnlessCached, startVivHarness } from "./viv-harness.ts";
import type { VivGoldenScene } from "./viv-scenes.ts";

const goldenDirectory = fileURLToPath(new URL("../goldens", import.meta.url));

const cmu1NdpiTissueCentre = { x: 34_816, y: 19_072 };

const scenes: readonly VivGoldenScene[] = [
  {
    name: "viv-cmu-1-ndpi-fit",
    fixture: "CMU-1.ndpi",
    formatId: "hamamatsu-ndpi",
    format: "ndpi",
    view: { kind: "fit" },
  },
  {
    name: "viv-cmu-1-ndpi-10x",
    fixture: "CMU-1.ndpi",
    formatId: "hamamatsu-ndpi",
    format: "ndpi",
    view: { kind: "magnification", magnification: 10, ...cmu1NdpiTissueCentre },
  },
];

test.describe.configure({ mode: "serial", timeout: 180_000 });

let server: ViteDevServer | null = null;

test.beforeAll(async () => {
  server = await startVivHarness();
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
    skipUnlessCached(scene.fixture);
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
