import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import type { ViteDevServer } from "vite";
import {
  type SyntheticHarness,
  type SyntheticRequest,
  type SyntheticResult,
  syntheticHarnessGlobal,
} from "../harness/viv/synthetic-protocol.ts";
import {
  finestPixel,
  syntheticHeight,
  syntheticTileSize,
  syntheticWidth,
} from "../harness/viv/synthetic-source.ts";
import { blockReport, checkGolden, type Frame } from "../src/index.ts";
import { assertSwiftShader, captureScreenshot } from "../src/playwright.ts";
import {
  fixtureAvailability,
  harnessUrl,
  openHarness,
  renderVivFrame,
  startVivHarness,
} from "./viv-harness.ts";
import {
  cmu1TileCorner,
  cmu1TileSize,
  VIV_80X_SCENE,
  VIV_SCENES,
  VIV_TILE_CORNER_SCENE,
  type VivGoldenScene,
} from "./viv-scenes.ts";

const goldenDirectory = fileURLToPath(new URL("../goldens", import.meta.url));
const availability = fixtureAvailability("CMU-1.svs");

const viewport = { width: 800, height: 600 };
const boundaryMargin = 0.02;

test.describe.configure({ mode: "serial", timeout: 180_000 });

let server: ViteDevServer | null = null;

test.beforeAll(async () => {
  if (availability.status === "missing" && availability.required) {
    throw new Error(availability.message);
  }
  server = await startVivHarness();
});

test.afterAll(async () => {
  await server?.close();
  server = null;
});

function startedServer(): ViteDevServer {
  if (server === null) throw new Error("The Viv harness server did not start");
  return server;
}

async function renderSynthetic(
  page: Page,
  request: SyntheticRequest,
): Promise<{ readonly result: SyntheticResult; readonly frame: Frame }> {
  await page.goto(`${harnessUrl(startedServer())}synthetic.html`);
  await page.waitForFunction((name) => name in globalThis, syntheticHarnessGlobal, {
    timeout: 60_000,
  });
  await assertSwiftShader(page);
  const result = await page.evaluate(
    async ({ name, scene }) => {
      const harness = (globalThis as unknown as Record<string, SyntheticHarness>)[name];
      if (harness === undefined) throw new Error("The synthetic harness did not load");
      return harness.render(scene);
    },
    { name: syntheticHarnessGlobal, scene: request },
  );
  const frame = await captureScreenshot(page.locator("#viewer canvas"));
  return { result, frame };
}

interface Oracle {
  readonly checked: number;
  readonly wrong: number;
  readonly borderChecked: number;
  readonly borderWrong: number;
}

function clamp(value: number, size: number): number {
  return Math.min(Math.max(value, 0), size - 1);
}

function finestOracle(frame: Frame, camera: SyntheticRequest["camera"], tile: number): Oracle {
  const scale = 2 ** camera.zoom;
  let checked = 0;
  let wrong = 0;
  let borderChecked = 0;
  let borderWrong = 0;
  for (let row = 0; row < frame.height; row++) {
    const y = camera.y + (row + 0.5 - frame.height / 2) / scale;
    const fractionY = y - Math.floor(y);
    if (fractionY < boundaryMargin || fractionY > 1 - boundaryMargin) continue;
    for (let column = 0; column < frame.width; column++) {
      const x = camera.x + (column + 0.5 - frame.width / 2) / scale;
      const fractionX = x - Math.floor(x);
      if (fractionX < boundaryMargin || fractionX > 1 - boundaryMargin) continue;
      const texelX = Math.floor(x);
      const texelY = Math.floor(y);
      if (texelX < 0 || texelY < 0 || texelX >= syntheticWidth || texelY >= syntheticHeight) {
        continue;
      }
      const expected = finestPixel(clamp(texelX, syntheticWidth), clamp(texelY, syntheticHeight));
      const offset = (row * frame.width + column) * 4;
      const matches =
        frame.data[offset] === expected[0] &&
        frame.data[offset + 1] === expected[1] &&
        frame.data[offset + 2] === expected[2];
      const onBorder =
        texelX % tile < 2 ||
        texelX % tile > tile - 3 ||
        texelY % tile < 2 ||
        texelY % tile > tile - 3;
      checked += 1;
      if (!matches) wrong += 1;
      if (onBorder) {
        borderChecked += 1;
        if (!matches) borderWrong += 1;
      }
    }
  }
  return { checked, wrong, borderChecked, borderWrong };
}

function impureCoarsePixels(frame: Frame): { impure: number; black: number; white: number } {
  let impure = 0;
  let black = 0;
  let white = 0;
  for (let offset = 0; offset < frame.data.length; offset += 4) {
    const red = frame.data[offset] ?? 0;
    const green = frame.data[offset + 1] ?? 0;
    const blue = frame.data[offset + 2] ?? 0;
    const pure = red === green && green === blue && (red === 0 || red === 255);
    if (!pure) impure += 1;
    else if (red === 0) black += 1;
    else white += 1;
  }
  return { impure, black, white };
}

const magnifiedViews: readonly {
  readonly label: string;
  readonly camera: SyntheticRequest["camera"];
}[] = [
  { label: "2x, centred on a tile corner", camera: { x: 1024, y: 768, zoom: 1 } },
  { label: "4x, centred on a tile corner", camera: { x: 1024, y: 768, zoom: 2 } },
  { label: "8x, centred on a tile corner", camera: { x: 512, y: 384, zoom: 3 } },
  { label: "a fractional zoom and centre", camera: { x: 1033.3, y: 770.7, zoom: 1.37 } },
];

for (const view of magnifiedViews) {
  test(`the finest level draws every texel crisp with no seam at tile borders at ${view.label}`, async ({
    page,
  }) => {
    const { result, frame } = await renderSynthetic(page, {
      camera: view.camera,
      interpolation: "finest-nearest",
    });
    expect(result.errors).toEqual([]);
    expect(result.camera).toEqual(view.camera);
    const finest = result.textures.filter((texture) => texture.tileZoom === 0);
    expect(finest.length).toBeGreaterThanOrEqual(4);
    for (const texture of finest) {
      expect(texture.magFilter).toBe("nearest");
      expect(texture.minFilter).toBe("linear");
    }
    const oracle = finestOracle(frame, view.camera, syntheticTileSize);
    expect(oracle.checked).toBeGreaterThan(frame.width * frame.height * 0.6);
    expect(oracle.borderChecked).toBeGreaterThan(1000);
    expect(oracle.wrong).toBe(0);
    expect(oracle.borderWrong).toBe(0);
  });
}

test("a route that filters the finest level linearly fails the crisp pixel check", async ({
  page,
}) => {
  const camera = { x: 1024, y: 768, zoom: 1 };
  const { result, frame } = await renderSynthetic(page, { camera, interpolation: "linear" });
  expect(result.textures.length).toBeGreaterThan(0);
  for (const texture of result.textures) {
    expect(texture.magFilter).toBe("linear");
    expect(texture.minFilter).toBe("linear");
  }
  const oracle = finestOracle(frame, camera, syntheticTileSize);
  expect(oracle.wrong).toBeGreaterThan(oracle.checked * 0.5);
  expect(oracle.borderWrong).toBeGreaterThan(oracle.borderChecked * 0.5);
});

for (const zoom of [-1.2, -1.3]) {
  test(`coarser levels filter linearly and never bleed across tile borders at zoom ${zoom}`, async ({
    page,
  }) => {
    const { result, frame } = await renderSynthetic(page, {
      camera: { x: syntheticWidth / 2, y: syntheticHeight / 2, zoom },
      interpolation: "finest-nearest",
    });
    expect(result.errors).toEqual([]);
    expect(result.camera.zoom).toBe(zoom);
    const coarse = result.textures.filter((texture) => (texture.tileZoom ?? 0) < 0);
    expect(coarse.length).toBeGreaterThanOrEqual(4);
    for (const texture of result.textures) {
      expect(texture.minFilter).toBe("linear");
      expect(texture.magFilter).toBe(texture.tileZoom === 0 ? "nearest" : "linear");
    }
    const pixels = impureCoarsePixels(frame);
    expect(pixels.impure).toBe(0);
    expect(pixels.black).toBeGreaterThan(1000);
    expect(pixels.white).toBeGreaterThan(1000);
  });
}

test("the finest level keeps a linear minification filter for views where its texels are smaller than a screen pixel", async ({
  page,
}) => {
  const { result } = await renderSynthetic(page, {
    camera: { x: syntheticWidth / 2, y: syntheticHeight / 2, zoom: -0.5 },
    interpolation: "finest-nearest",
  });
  const finest = result.textures.filter((texture) => texture.tileZoom === 0);
  expect(finest.length).toBeGreaterThan(0);
  for (const texture of finest) expect(texture.minFilter).toBe("linear");
});

test.describe("CMU-1.svs digital zoom", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(
      availability.status === "missing",
      availability.status === "missing" ? availability.message : "",
    );
    await openHarness(page, startedServer());
    await assertSwiftShader(page);
  });

  const goldenScenes: readonly VivGoldenScene[] = [VIV_80X_SCENE, VIV_TILE_CORNER_SCENE];

  for (const scene of goldenScenes) {
    test(`${scene.name} matches its golden image`, async ({ page }, testInfo) => {
      const { result, frame } = await renderVivFrame(page, scene);
      expect(result.errors).toEqual([]);
      const outcome = checkGolden(frame, {
        name: scene.name,
        format: scene.format,
        goldenDirectory,
        outputDirectory: testInfo.outputDir,
      });
      if (outcome.status === "mismatched") throw new Error(outcome.message);
    });
  }

  test("the tile corner scene sits on a corner of the finest tiles", async ({ page }) => {
    const { result } = await renderVivFrame(page, VIV_TILE_CORNER_SCENE);
    expect(result.tileSize).toBe(cmu1TileSize);
    expect(result.camera.x % result.tileSize).toBe(0);
    expect(result.camera.y % result.tileSize).toBe(0);
    expect(result.camera).toEqual({ ...cmu1TileCorner, zoom: 2 });
  });

  test("at 4x every slide pixel is one uniform block of screen pixels, across tile borders too", async ({
    page,
  }) => {
    const { frame } = await renderVivFrame(page, VIV_TILE_CORNER_SCENE);
    const report = blockReport(frame, 4);
    expect(report.blocks).toBe((viewport.width / 4) * (viewport.height / 4));
    expect(report.mixedBlocks).toBe(0);
    expect(report.differingPairs / report.neighbourPairs).toBeGreaterThan(0.5);
  });

  test("a route that filters the finest level linearly breaks the 4x blocks", async ({ page }) => {
    const { frame } = await renderVivFrame(page, VIV_TILE_CORNER_SCENE, "linear-everywhere");
    const report = blockReport(frame, 4);
    expect(report.mixedBlocks / report.blocks).toBeGreaterThan(0.5);
  });

  test("a route that filters the finest level linearly fails the 40x, 80x and corner goldens", async ({
    page,
  }, testInfo) => {
    const fortyX = VIV_SCENES.find((scene) => scene.name.endsWith("-40x"));
    if (fortyX === undefined) throw new Error("No 40x scene is defined");
    for (const scene of [fortyX, VIV_80X_SCENE, VIV_TILE_CORNER_SCENE]) {
      const { frame } = await renderVivFrame(page, scene, "linear-everywhere");
      const outcome = checkGolden(frame, {
        name: scene.name,
        format: scene.format,
        goldenDirectory,
        outputDirectory: testInfo.outputDir,
        update: false,
      });
      expect(outcome.status, scene.name).toBe("mismatched");
    }
  });

  test("the 10x tissue view keeps its linear coarser levels", async ({ page }) => {
    const tenX = VIV_SCENES.find((scene) => scene.name.endsWith("-10x"));
    if (tenX === undefined) throw new Error("No 10x scene is defined");
    const rule = await renderVivFrame(page, tenX);
    const linear = await renderVivFrame(page, tenX, "linear-everywhere");
    expect(Buffer.from(rule.frame.data).equals(Buffer.from(linear.frame.data))).toBe(true);
  });
});
