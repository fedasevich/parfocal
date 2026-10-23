import { fileURLToPath } from "node:url";
import { chromium, type Page, test } from "@playwright/test";
import { type Comparison, compareFrames, goldenPath, readPng, toleranceFor } from "../src/index.ts";
import { captureWebglCanvas, webglRendererName } from "../src/playwright.ts";
import { type RenderOptions, renderScene, SCENES } from "./scenes.ts";

const goldenDirectory = fileURLToPath(new URL("../goldens", import.meta.url));
const REPEATS = 5;

test.skip(
  process.env.GOLDEN_MEASURE !== "1",
  "Set GOLDEN_MEASURE=1 to print the measurement tables",
);

function row(label: string, renderer: string, comparison: Comparison): string {
  const max = Math.max(...comparison.maxDelta);
  const mean = comparison.meanError.map((value) => value.toFixed(3)).join(" / ");
  return `| ${label} | ${renderer} | ${max} | ${mean} | ${(comparison.differingFraction * 100).toFixed(3)}% | ${comparison.pass ? "pass" : "fail"} |`;
}

async function measure(page: Page, label: string, options: RenderOptions): Promise<string[]> {
  const renderer = await webglRendererName(page);
  const rows: string[] = [];
  for (const scene of SCENES) {
    const golden = readPng(goldenPath(goldenDirectory, scene.name));
    let worst: Comparison | null = null;
    for (let attempt = 0; attempt < REPEATS; attempt++) {
      const frame = await captureWebglCanvas(page, await renderScene(page, scene, options));
      const comparison = compareFrames(frame, golden, toleranceFor(scene.format));
      if (!worst || Math.max(...comparison.maxDelta) > Math.max(...worst.maxDelta)) {
        worst = comparison;
      }
    }
    if (worst) {
      rows.push(row(`${scene.name}, ${label}`, renderer, worst));
    }
  }
  return rows;
}

test("print golden measurements", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setContent("<!doctype html><html><body></body></html>");
  const rows = [
    "| Scene and variant | WebGL renderer | Max channel delta | Mean error R / G / B | Pixels over the lossless delta | Lossless tolerance |",
    "|---|---|---|---|---|---|",
    ...(await measure(page, "SwiftShader", {})),
    ...(await measure(page, "SwiftShader, R and B swapped", { channelOrder: "bgr" })),
  ];
  const hardware = await chromium.launch({ channel: "chrome", headless: true, args: [] });
  try {
    const hardwarePage = await hardware.newPage({ deviceScaleFactor: 1 });
    await hardwarePage.setContent("<!doctype html><html><body></body></html>");
    rows.push(...(await measure(hardwarePage, "default GPU", {})));
  } finally {
    await hardware.close();
  }
  console.log(rows.join("\n"));
});
