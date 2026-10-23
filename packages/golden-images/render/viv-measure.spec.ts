import { fileURLToPath } from "node:url";
import { chromium, type Page, test } from "@playwright/test";
import type { VivBreakage } from "../harness/viv/protocol.ts";
import {
  type Comparison,
  compareFrames,
  contentProblems,
  goldenPath,
  readPng,
  toleranceFor,
} from "../src/index.ts";
import { webglRendererName } from "../src/playwright.ts";
import {
  fixtureAvailability,
  openHarness,
  renderVivFrame,
  startVivHarness,
} from "./viv-harness.ts";
import { VIV_SCENES } from "./viv-scenes.ts";

const goldenDirectory = fileURLToPath(new URL("../goldens", import.meta.url));
const REPEATS = 5;

test.skip(
  process.env.GOLDEN_MEASURE !== "1" || fixtureAvailability("CMU-1.svs").status !== "ready",
  "Set GOLDEN_MEASURE=1 with CMU-1.svs fetched to print the Viv measurement tables",
);

function row(label: string, renderer: string, comparison: Comparison, extra: string): string {
  const max = Math.max(...comparison.maxDelta);
  const mean = comparison.meanError.map((value) => value.toFixed(3)).join(" / ");
  return `| ${label} | ${renderer} | ${max} | ${mean} | ${(comparison.differingFraction * 100).toFixed(3)}% | ${comparison.pass ? "pass" : "fail"} | ${extra} |`;
}

async function measure(page: Page, label: string, breakage: VivBreakage): Promise<string[]> {
  const renderer = await webglRendererName(page);
  const rows: string[] = [];
  for (const scene of VIV_SCENES) {
    const golden = readPng(goldenPath(goldenDirectory, scene.name));
    let worst: Comparison | null = null;
    const times: number[] = [];
    let problems: string[] = [];
    for (let attempt = 0; attempt < REPEATS; attempt++) {
      const { frame, ms } = await renderVivFrame(page, scene, breakage);
      times.push(ms);
      problems = contentProblems(frame);
      const comparison = compareFrames(frame, golden, toleranceFor(scene.format));
      if (!worst || Math.max(...comparison.maxDelta) > Math.max(...worst.maxDelta)) {
        worst = comparison;
      }
    }
    const sorted = [...times].sort((a, b) => a - b);
    const extra = `${Math.round(sorted[0] ?? 0)} / ${Math.round(sorted[Math.floor(sorted.length / 2)] ?? 0)} / ${Math.round(sorted.at(-1) ?? 0)} ms; ${problems.length === 0 ? "has content" : problems.join(", ")}`;
    if (worst) rows.push(row(`${scene.name}, ${label}`, renderer, worst, extra));
  }
  return rows;
}

test("print Viv golden measurements", async ({ page }) => {
  test.setTimeout(900_000);
  const server = await startVivHarness();
  try {
    await openHarness(page, server);
    const rows = [
      "| Scene and variant | WebGL renderer | Max channel delta | Mean error R / G / B | Pixels over the JPEG delta | JPEG tolerance | Open to idle min / median / max, content check |",
      "|---|---|---|---|---|---|---|",
      ...(await measure(page, "SwiftShader", "none")),
      ...(await measure(page, "SwiftShader, R and B swapped", "swap-red-blue")),
      ...(await measure(page, "SwiftShader, 4x level read as 2x", "wrong-level")),
      ...(await measure(page, "SwiftShader, YCbCr handed over as RGB", "ycbcr-as-rgb")),
    ];
    const hardware = await chromium.launch({ channel: "chrome", headless: true, args: [] });
    try {
      const hardwarePage = await hardware.newPage({
        deviceScaleFactor: 1,
        viewport: { width: 800, height: 600 },
      });
      await openHarness(hardwarePage, server);
      rows.push(...(await measure(hardwarePage, "default GPU", "none")));
    } finally {
      await hardware.close();
    }
    console.log(rows.join("\n"));
  } finally {
    await server.close();
  }
});
