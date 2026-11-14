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
const FRAME = { width: 1440, height: 900 };
const USAGE = [
  "Usage: pnpm --filter @parfocal/web shot APP_URL OUT.png [--against URL_OR_PNG]",
  "Options: --theme light|dark --size 1440x900 --scale 0.5 --wait 500",
].join("\n");

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    against: { type: "string" },
    size: { type: "string", default: `${FRAME.width}x${FRAME.height}` },
    scale: { type: "string", default: "0.5" },
    wait: { type: "string", default: "500" },
    theme: { type: "string", default: "light" },
  },
});

const [url, out] = positionals;
if (!url || !out) {
  console.error(USAGE);
  process.exit(1);
}

const [width = FRAME.width, height = FRAME.height] = values.size.split("x").map(Number);
const browser = await chromium.launch({ channel: "chrome" });
const theme: "dark" | "light" = values.theme === "dark" ? "dark" : "light";
const context = await browser.newContext({
  deviceScaleFactor: Number(values.scale),
  colorScheme: theme,
  viewport: { width, height },
});
await context.addInitScript((choice) => {
  window.localStorage.setItem("parfocal.device-settings", JSON.stringify({ theme: choice }));
}, theme);

async function shoot(target: string): Promise<Frame> {
  const page = await context.newPage();
  await page.goto(target, { waitUntil: "networkidle" });
  await page.evaluate((choice) => {
    document.documentElement.dataset["theme"] = choice;
  }, theme);
  await page.waitForTimeout(Number(values.wait));
  const frame = decodePng(await page.screenshot());
  await page.close();
  return frame;
}

async function expectedFrame(): Promise<Frame | null> {
  if (!values.against) return null;
  return existsSync(values.against) ? readPng(values.against) : shoot(values.against);
}

try {
  const actual = await shoot(url);
  writePng(out, actual);
  const lines = [`${out} ${actual.width}x${actual.height}`];
  const expected = await expectedFrame();
  if (expected) {
    const comparison = compareFrames(actual, expected, LOOSE);
    const diffPath = out.replace(/\.png$/, "-diff.png");
    writePng(diffPath, diffFrame(actual, expected, LOOSE));
    const mean = comparison.meanError.reduce((sum, channel) => sum + channel, 0) / 3;
    lines.push(
      comparison.failures[0]?.startsWith("Size")
        ? comparison.failures[0]
        : `differs on ${(comparison.differingFraction * 100).toFixed(1)}% of pixels, mean error ${mean.toFixed(1)}, diff in ${diffPath}`,
    );
  }
  console.log(lines.join("\n"));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await browser.close();
}
