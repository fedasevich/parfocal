import { expect, type Page, test } from "./a11y.ts";

test.use({ viewport: { width: 1440, height: 900 } });

const p07 = "00000000-0000-4000-8003-000000000007";
const rt16 = "00000000-0000-4000-8043-000000000016";
const cellsSlide = "00000000-0000-4000-8005-000000000008";

const outlines = (page: Page) => page.getByTestId("review-object-outlines");

const shownOf = async (page: Page) =>
  JSON.parse((await outlines(page).getAttribute("data-shown")) ?? "[]") as {
    part: string;
    dot: number | null;
  }[];

const hasDot = async (page: Page) => (await shownOf(page)).some((part) => part.dot !== null);

const zoomUntil = async (page: Page, direction: "in" | "out", draw: string) => {
  const box = await page.getByTestId("slide-stage").boundingBox();
  await page.mouse.move((box?.x ?? 0) + 200, (box?.y ?? 0) + 200);
  for (let step = 0; step < 60; step += 1) {
    if ((await outlines(page).getAttribute("data-draw")) === draw) return;
    await page.mouse.wheel(0, direction === "out" ? 60 : -60);
    await page.waitForTimeout(40);
  }
};

test("a task drawing cells as dots shows their outlines once zoomed in and never a dot for the current cell", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto(`/projects/${p07}/slides/${cellsSlide}?task=${rt16}&mode=guided&object=C2`);
  const panel = page.getByTestId("stage-review-objects");
  await expect(panel).toHaveAttribute("data-ready", "true", { timeout: 25_000 });
  const start = page.getByRole("button", { name: "Got it, start" });
  if (await start.isVisible()) await start.click();
  await expect(panel).toHaveAttribute("data-current", "C2");
  await page.getByRole("tab", { name: "Display" }).click();
  await page.getByRole("radiogroup", { name: "Draw as" }).getByText("Dots").click();
  await expect(outlines(page)).toHaveAttribute("data-setting-draw", "dots");

  await expect(outlines(page)).toHaveAttribute("data-draw", "outline");
  await expect.poll(() => hasDot(page)).toBe(false);
  expect((await shownOf(page)).some((part) => part.part === "current")).toBe(true);

  await zoomUntil(page, "out", "dots");
  await expect(outlines(page)).toHaveAttribute("data-draw", "dots");
  await expect(outlines(page)).toHaveAttribute("data-setting-draw", "dots");
  await expect.poll(() => hasDot(page)).toBe(true);

  await zoomUntil(page, "in", "outline");
  await expect(outlines(page)).toHaveAttribute("data-draw", "outline");
  await expect.poll(() => hasDot(page)).toBe(false);
});
