import { expect, type Page, test } from "./a11y.ts";

test.use({ viewport: { width: 1440, height: 900 } });

const p07 = "00000000-0000-4000-8003-000000000007";
const rt14 = "00000000-0000-4000-8007-000000000014";
const rt16 = "00000000-0000-4000-8043-000000000016";
const cellsSlide = "00000000-0000-4000-8005-000000000008";

type Shown = { part: string; outline: number; fill: number; dot: number | null };

async function openGuided(page: Page) {
  await page.goto(`/projects/${p07}/slides/${cellsSlide}?task=${rt16}&mode=guided&object=C2`);
  const panel = page.getByTestId("stage-review-objects");
  await expect(panel).toHaveAttribute("data-ready", "true", { timeout: 25_000 });
  const start = page.getByRole("button", { name: "Got it, start" });
  if (await start.isVisible()) await start.click();
  await expect(panel).toHaveAttribute("data-current", "C2");
}

const outlines = (page: Page) => page.getByTestId("review-object-outlines");

async function shown(page: Page): Promise<Shown[]> {
  return JSON.parse((await outlines(page).getAttribute("data-shown")) ?? "[]") as Shown[];
}

const part = (all: Shown[], name: string) => all.find((entry) => entry.part === name);

async function setOpacity(page: Page, percent: number) {
  await page.getByRole("tab", { name: "Display" }).click();
  const slider = page.getByRole("slider", { name: "Opacity" });
  await slider.focus();
  await page.keyboard.press("End");
  for (let step = 100; step > percent; step -= 10) await page.keyboard.press("ArrowLeft");
  await expect(slider).toHaveAttribute("aria-valuenow", String(percent));
}

async function drawAs(page: Page, mode: string) {
  await page
    .locator('[data-slot="control-row"]')
    .filter({ hasText: "Draw as" })
    .getByRole("radio", { name: mode })
    .click();
}

test("at 10% opacity the outline, fill and dots draw at a tenth and the current object stays marked", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openGuided(page);
  await setOpacity(page, 10);
  await expect.poll(async () => part(await shown(page), "main")?.outline).toBeCloseTo(0.1, 5);
  const outline = await shown(page);
  expect(part(outline, "main")?.fill).toBe(0);
  expect(part(outline, "main")?.dot).toBeNull();
  const ring = part(outline, "current")?.outline ?? 0;
  expect(ring).toBeGreaterThanOrEqual(0.5);
  expect(ring).toBeLessThan(0.6);

  await drawAs(page, "Fill");
  await expect.poll(async () => part(await shown(page), "main")?.fill).toBeGreaterThan(0.07);
  const filled = part(await shown(page), "main");
  expect(filled?.fill).toBeLessThan(0.1);
  expect(filled?.outline).toBeCloseTo(0.1, 5);

  await drawAs(page, "Dots");
  await expect.poll(async () => part(await shown(page), "main")?.dot ?? null).toBeCloseTo(0.1, 5);

  await setOpacity(page, 100);
  await expect.poll(async () => part(await shown(page), "main")?.dot ?? null).toBeCloseTo(1, 5);
  expect(part(await shown(page), "current")?.outline).toBeCloseTo(1, 5);
});

test("the opacity stays chosen for this person after a reload", async ({ page }) => {
  test.setTimeout(120_000);
  await openGuided(page);
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === "PUT" &&
      response.url().includes("/my-display") &&
      (response.request().postData() ?? "").includes("30"),
  );
  await setOpacity(page, 30);
  await saved;
  await openGuided(page);
  await expect(page.getByTestId("review-object-outlines")).toHaveAttribute("data-opacity", "30");
});

test("drawn shapes in Annotate fade with the same opacity", async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    localStorage.setItem("parfocal.device-settings", JSON.stringify({ "display.fillOpacity": 10 }));
  });
  await page.goto(`/projects/${p07}?tab=slides`);
  await page.getByTestId("slide-row").filter({ hasText: "tumor_044" }).click();
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 25_000 });
  const url = new URL(page.url());
  await page.goto(`${url.pathname}?task=${rt14}&mode=annotate`);
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 25_000 });
  await expect(stage).toHaveAttribute("data-annotations", "loaded");
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0 };
  await page.keyboard.press("r");
  await page.mouse.move(box.x + 300, box.y + 250);
  await page.mouse.down();
  await page.mouse.move(box.x + 460, box.y + 330, { steps: 5 });
  await page.mouse.up();
  const shape = page.getByTestId("polygon-shape");
  await expect(shape).toHaveCount(1);
  await expect(shape).toHaveAttribute("data-opacity", "0.1");
  await expect(shape).toHaveCSS("opacity", "0.1");
});
