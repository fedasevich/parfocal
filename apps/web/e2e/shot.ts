import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  compareFrames,
  decodePng,
  diffFrame,
  type Frame,
  readPng,
  writePng,
} from "@parfocal/golden-images";
import { type BrowserContext, chromium } from "@playwright/test";

const LOOSE = { maxChannelDelta: 24, maxDifferingFraction: 1, maxMeanChannelError: 255 };
const MOCK = fileURLToPath(new URL("../../../docs/design/ux-mock/index.html", import.meta.url));
const MOCK_FRAME = { width: 1440, height: 900 };
const USAGE = [
  "Usage: pnpm --filter @parfocal/web shot APP_URL OUT.png [--mock SCREEN/SCENE | --against URL_OR_PNG]",
  "       pnpm --filter @parfocal/web shot --mock SCREEN/SCENE OUT.png",
  "Options: --theme light|dark --size 1440x900 --scale 0.5 --wait 500",
].join("\n");

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    against: { type: "string" },
    mock: { type: "string" },
    size: { type: "string", default: `${MOCK_FRAME.width}x${MOCK_FRAME.height}` },
    scale: { type: "string", default: "0.5" },
    wait: { type: "string", default: "500" },
    theme: { type: "string", default: "light" },
  },
});

const [first, second] = positionals;
const url = second === undefined ? undefined : first;
const out = second ?? first;
if (!out || (!url && !values.mock)) {
  console.error(USAGE);
  process.exit(1);
}

const [width = MOCK_FRAME.width, height = MOCK_FRAME.height] = values.size.split("x").map(Number);
const browser = await chromium.launch({ channel: "chrome" });
const theme: "dark" | "light" = values.theme === "dark" ? "dark" : "light";
const settings = { deviceScaleFactor: Number(values.scale), colorScheme: theme };
const appContext = await browser.newContext({ ...settings, viewport: { width, height } });
const mockContext = await browser.newContext({
  ...settings,
  viewport: { width: MOCK_FRAME.width + 200, height: MOCK_FRAME.height + 400 },
});

for (const context of [appContext, mockContext]) {
  await context.addInitScript((choice) => {
    window.localStorage.setItem("parfocal.device-settings", JSON.stringify({ theme: choice }));
    window.localStorage.setItem("mock-theme", choice);
  }, theme);
}

async function shootApp(context: BrowserContext, target: string): Promise<Frame> {
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

async function shootMock(spec: string): Promise<Frame> {
  const [screen = "", scene] = spec.split("/");
  const page = await mockContext.newPage();
  await page.goto(`file://${MOCK}#${screen}`);
  const problem = await page.evaluate<string>(
    `(() => {
      const current = screens[step];
      if (current.id !== ${JSON.stringify(screen)}) return "No mock screen " + ${JSON.stringify(screen)} + ". Screens: " + screens.map((s) => s.id).join(", ");
      const scene = ${JSON.stringify(scene ?? null)};
      if (scene !== null) {
        const keys = current.scenes ? current.scenes.list.map(([key]) => key) : [];
        if (!keys.includes(scene)) return "No scene " + scene + " on " + current.id + ". Scenes: " + (keys.join(", ") || "none");
        current.scenes.set(scene);
        renderStep();
      }
      const app = document.getElementById("app");
      app.style.transform = "none";
      return "";
    })()`,
  );
  if (problem) {
    throw new Error(problem);
  }
  await page.waitForTimeout(Number(values.wait));
  const box = await page.locator("#app").boundingBox();
  if (box === null) {
    throw new Error("The mock drew no #app frame");
  }
  const clip = { x: box.x, y: box.y, ...MOCK_FRAME };
  const frame = decodePng(await page.screenshot({ clip, fullPage: true }));
  await page.close();
  return frame;
}

async function expectedFrame(): Promise<Frame | null> {
  if (values.mock && url) return shootMock(values.mock);
  if (!values.against) return null;
  return existsSync(values.against)
    ? readPng(values.against)
    : shootApp(appContext, values.against);
}

try {
  const actual = url ? await shootApp(appContext, url) : await shootMock(values.mock ?? "");
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
