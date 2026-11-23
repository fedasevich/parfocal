import type { Page } from "@playwright/test";
import { expect, test } from "./telemetry-capture.ts";

const project = "00000000-0000-4000-8003-000000000007";
const hitSlide = "00000000-0000-4000-8005-000000000001";
const otherSlide = "00000000-0000-4000-8005-000000000002";

type Point = { x: number; y: number };

const reach = 2;

async function cameraCentre(page: Page): Promise<Point | null> {
  const text = await page.getByTestId("slide-host").getAttribute("data-camera");
  const [x, y] = (text ?? "").split(",").map(Number);
  return x === undefined || y === undefined || Number.isNaN(x) || Number.isNaN(y) ? null : { x, y };
}

async function expectCentredOn(page: Page, expected: () => Promise<Point>) {
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
    timeout: 30_000,
  });
  await expect
    .poll(
      async () => {
        const camera = await cameraCentre(page);
        const target = await expected();
        return camera === null ? Infinity : Math.hypot(camera.x - target.x, camera.y - target.y);
      },
      { timeout: 20_000 },
    )
    .toBeLessThan(reach);
}

async function regionCentre(page: Page, object: string): Promise<Point> {
  return page.evaluate(
    async ([slide, wanted]) => {
      const response = await fetch(`/api/slides/${slide}/areas`);
      const rows = (await response.json()) as {
        object: string;
        x: number;
        y: number;
        width: number;
        height: number;
      }[];
      const row = rows.find((item) => item.object === wanted);
      if (row === undefined) throw new Error(`no area ${wanted}`);
      return { x: row.x + row.width / 2, y: row.y + row.height / 2 };
    },
    [hitSlide, object] as const,
  );
}

async function pickedCellCentre(page: Page): Promise<Point> {
  const text = await page
    .locator('[data-testid="result-set-cells"][data-picked-centre]:not([data-picked-centre=""])')
    .first()
    .getAttribute("data-picked-centre", { timeout: 20_000 });
  const [x, y] = (text ?? "").split(",").map(Number);
  return { x: x ?? Number.NaN, y: y ?? Number.NaN };
}

const drawnRing = [
  [700, 500],
  [800, 500],
  [800, 560],
  [700, 560],
  [700, 500],
];
const drawnCentre: Point = { x: 750, y: 530 };

async function drawShape(page: Page) {
  await page.goto(`/projects/${project}/slides/${hitSlide}`);
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-annotations", "loaded", {
    timeout: 30_000,
  });
  const saved = await page.evaluate(
    async ([slide, ring]) => {
      const response = await fetch(`/api/slides/${slide}/annotations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "region",
          geometry: { type: "Polygon", coordinates: [ring] },
          class_id: null,
        }),
      });
      return ((await response.json()) as { code: string }).code;
    },
    [hitSlide, drawnRing] as const,
  );
  expect(saved).toBe("T1+");
}

async function openPalette(page: Page) {
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(async () => {
    if (!(await palette.isVisible())) await page.keyboard.press("ControlOrMeta+k");
    await expect(palette).toBeVisible({ timeout: 500 });
  }).toPass();
  return palette;
}

async function pickFromSearchPage(page: Page, typed: string, shown: RegExp) {
  await page.goto("/search");
  await page.getByRole("textbox", { name: "Search everything" }).fill(typed);
  await page.getByRole("button", { name: shown }).first().click();
}

async function pickFromPalette(page: Page, typed: string, shown: RegExp) {
  const palette = await openPalette(page);
  await palette.getByRole("combobox").fill(typed);
  await palette.getByRole("option", { name: shown }).first().click();
}

const kinds = [
  {
    kind: "an AI cell",
    typed: "C145",
    shown: /^C145 on A1/,
    check: async (page: Page) => {
      await expectCentredOn(page, () => pickedCellCentre(page));
      await expect(page.getByTestId("result-set-cells").first()).toHaveAttribute(
        "data-picked",
        /:145$/,
      );
    },
  },
  {
    kind: "an AI region",
    typed: "T2",
    shown: /^T2 on A1/,
    check: async (page: Page) => {
      await expectCentredOn(page, () => regionCentre(page, "T2"));
    },
  },
  {
    kind: "a drawn shape",
    typed: "T1+",
    shown: /^T1\+ on A1/,
    prepare: drawShape,
    check: async (page: Page) => {
      await expectCentredOn(page, () => Promise.resolve(drawnCentre));
      await expect(page.getByTestId("select-layer")).toHaveAttribute("data-selected", /\d/);
    },
  },
];

for (const item of kinds) {
  test(`picking ${item.kind} on the search page opens its slide centred on it`, async ({
    page,
  }) => {
    await item.prepare?.(page);
    await pickFromSearchPage(page, item.typed, item.shown);
    await expect(page).toHaveURL(new RegExp(`/slides/${hitSlide}\\?.*object=`));
    await item.check(page);
  });

  test(`picking ${item.kind} in the palette from home opens its slide centred on it`, async ({
    page,
  }) => {
    await item.prepare?.(page);
    await page.goto("/");
    await pickFromPalette(page, item.typed, item.shown);
    await expect(page).toHaveURL(new RegExp(`/slides/${hitSlide}\\?.*object=`));
    await item.check(page);
  });

  test(`picking ${item.kind} in the palette from another slide opens its slide centred on it`, async ({
    page,
  }) => {
    await item.prepare?.(page);
    await page.goto(`/projects/${project}/slides/${otherSlide}`);
    await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
      timeout: 30_000,
    });
    await pickFromPalette(page, `s26-04812 a1 ${item.typed}`, item.shown);
    await expect(page).toHaveURL(new RegExp(`/slides/${hitSlide}\\?.*object=`));
    await item.check(page);
  });
}

test("picking a cell in the palette on its own slide moves the camera to it", async ({ page }) => {
  await page.goto(`/projects/${project}/slides/${hitSlide}`);
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
    timeout: 30_000,
  });
  await pickFromPalette(page, "C145", /^C145 on A1/);
  await expect(page).toHaveURL(/object=C145/);
  await expectCentredOn(page, () => pickedCellCentre(page));
});
