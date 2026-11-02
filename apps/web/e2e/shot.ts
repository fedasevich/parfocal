import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import {
  compareFrames,
  decodePng,
  diffFrame,
  type Frame,
  readPng,
  writePng,
} from "@parfocal/golden-images";
import { chromium } from "@playwright/test";

const LOOSE = { maxChannelDelta: 24, maxDifferingFraction: 1, maxMeanChannelError: 255 };

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    against: { type: "string" },
    size: { type: "string", default: "1440x900" },
    scale: { type: "string", default: "0.5" },
    wait: { type: "string", default: "500" },
  },
});

const [url, out] = positionals;
if (!url || !out) {
  console.error(
    "Usage: node apps/web/e2e/shot.ts URL OUT.png [--against URL|PNG] [--size 1440x900] [--scale 0.5]",
  );
  process.exit(1);
}

const [width, height] = values.size.split("x").map(Number);
const browser = await chromium.launch({ channel: "chrome" });
const context = await browser.newContext({
  viewport: { width: width ?? 1440, height: height ?? 900 },
  deviceScaleFactor: Number(values.scale),
});

async function shoot(target: string): Promise<Frame> {
  const page = await context.newPage();
  await page.goto(target, { waitUntil: "networkidle" });
  await page.waitForTimeout(Number(values.wait));
  const frame = decodePng(await page.screenshot());
  await page.close();
  return frame;
}

const actual = await shoot(url);
writePng(out, actual);
const lines = [`${out} ${actual.width}x${actual.height}`];

if (values.against) {
  const expected = existsSync(values.against)
    ? readPng(values.against)
    : await shoot(values.against);
  const comparison = compareFrames(actual, expected, LOOSE);
  const diffPath = out.replace(/\.png$/, "-diff.png");
  writePng(diffPath, diffFrame(actual, expected, LOOSE));
  const mean = comparison.meanError.reduce((sum, channel) => sum + channel, 0) / 3;
  lines.push(
    `differs on ${(comparison.differingFraction * 100).toFixed(1)}% of pixels, mean error ${mean.toFixed(1)}, diff in ${diffPath}`,
  );
}

await browser.close();
console.log(lines.join("\n"));
