import { expect, type Page, test } from "./a11y.ts";

const rt14 = "00000000-0000-4000-8007-000000000014";
const a1 = "00000000-0000-4000-8005-000000000001";

test.use({ viewport: { width: 1280, height: 900 } });

const answers = (page: Page, object: string) =>
  page.getByRole("group", { name: `Your answer on ${object}` });

const saved = (page: Page, path: string) =>
  page.waitForRequest((request) => request.method() === "PUT" && request.url().includes(path));

test("a reviewer agrees with, disagrees with and fixes a drawn outline", async ({ page }) => {
  await page.goto(`/tasks/${rt14}/guided?slide=${a1}&scene=region&source=drawn`);
  await expect(page.getByText(/A person drew T5⁺ (by hand|with Smart select)/)).toBeVisible();
  await expect(page.getByRole("button", { name: "T5⁺", exact: true })).toBeVisible();
  await expect(page.getByText(/The AI says T5/)).toHaveCount(0);

  const agreed = saved(page, "/decisions/T5");
  await answers(page, "T5").getByRole("button", { name: /Agree/ }).click();
  expect((await agreed).postDataJSON()).toMatchObject({ value: "agree" });

  await page.goto(`/tasks/${rt14}/guided?slide=${a1}&scene=region&source=drawn`);
  await answers(page, "T5")
    .getByRole("button", { name: /Disagree/ })
    .click();
  await expect(page.getByText("You disagree with the drawn outline T5⁺")).toBeVisible();

  const fixed = saved(page, "/edits/T5");
  await page.getByRole("button", { name: "Redraw the outline" }).click();
  const stage = page.locator("[data-slot=slide-still]");
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };
  for (const [x, y] of [
    [0.3, 0.3],
    [0.6, 0.32],
    [0.58, 0.6],
    [0.32, 0.55],
  ] as const) {
    await page.mouse.click(box.x + box.width * x, box.y + box.height * y);
  }
  await page.getByRole("button", { name: "Finish outline" }).click();
  const body = (await fixed).postDataJSON() as { geometry: { type: string } };
  expect(body.geometry.type).toBe("Polygon");
  await expect(page.getByTestId("redrawn-outline")).toHaveAttribute("data-points", "4");
});
