import { expect, type Page, test } from "./a11y.ts";

test.describe.configure({ timeout: 90_000 });

const rt14 = "00000000-0000-4000-8007-000000000014";
const rt16 = "00000000-0000-4000-8043-000000000016";
const a1 = "00000000-0000-4000-8005-000000000001";

const panel = (page: Page) => page.getByRole("tabpanel");

async function openDisplay(page: Page, task: string) {
  await page.goto(`/tasks/${task}/guided?slide=${a1}&scene=region`);
  await page.getByRole("tab", { name: "Display" }).click();
  const body = panel(page);
  await expect(body.getByText(/^Only for you, on RT-/)).toBeVisible();
  return body;
}

const answerGroup = (page: Page) => page.getByRole("group", { name: /^Your answer on / });

const positionText = (page: Page) => page.getByText(/^Object \d+ of \d+ on this slide/);

const backButton = (page: Page) => page.getByRole("button", { name: /^Back to / });

test("the order setting changes which object guided review opens on", async ({ page }) => {
  const body = await openDisplay(page, rt16);
  await page.getByRole("tab", { name: "Review" }).click();
  const aiFirst = await backButton(page).textContent();
  const seen = new Set([aiFirst]);
  for (const name of ["Largest first", "Least sure first", "Random"]) {
    await page.getByRole("tab", { name: "Display" }).click();
    await body.getByRole("radiogroup", { name: "Order" }).getByRole("radio", { name }).click();
    await page.getByRole("tab", { name: "Review" }).click();
    seen.add(await backButton(page).textContent());
  }
  expect(seen.size).toBeGreaterThan(1);
});

test("the zoom setting changes how close the camera starts", async ({ page }) => {
  const body = await openDisplay(page, rt14);
  const stage = page.locator('[data-slot="slide-still"]');
  const scaleOf = async () => Number(await stage.getAttribute("data-scale"));
  const fit = await scaleOf();
  const zoom = body.getByRole("radiogroup", { name: "Zoom around the object" });
  await zoom.getByRole("radio", { name: "Tight" }).click();
  await expect.poll(scaleOf).toBeGreaterThan(fit);
  await zoom.getByRole("radio", { name: "Context" }).click();
  await expect.poll(scaleOf).toBeLessThan(fit);
});

test("move on by itself decides whether an answer goes to the next object", async ({ page }) => {
  const body = await openDisplay(page, rt14);
  const toggle = body.getByRole("switch", { name: /Move on by itself/ });
  await toggle.click();
  await page.getByRole("tab", { name: "Review" }).click();
  const before = (await positionText(page).textContent()) ?? "";
  await answerGroup(page).getByRole("button").first().click();
  await expect(positionText(page)).toHaveText(before);
  await page.getByRole("tab", { name: "Display" }).click();
  await toggle.click();
  await page.getByRole("tab", { name: "Review" }).click();
  await answerGroup(page).getByRole("button").first().click();
  await expect(positionText(page)).not.toHaveText(before);
});

test("the answer buttons move under the slide and back into the card", async ({ page }) => {
  const body = await openDisplay(page, rt14);
  const under = page.getByTestId("under-slide-buttons");
  await expect(under).toBeHidden();
  const place = body.getByRole("radiogroup", { name: "Answer buttons" });
  await place.getByRole("radio", { name: "Under the slide" }).click();
  await page.getByRole("tab", { name: "Review" }).click();
  await expect(under.getByRole("group", { name: /^Your answer on / })).toBeVisible();
  await expect(panel(page).getByRole("group", { name: /^Your answer on / })).toHaveCount(0);
  await page.getByRole("tab", { name: "Display" }).click();
  await place.getByRole("radio", { name: "In the card" }).click();
  await page.getByRole("tab", { name: "Review" }).click();
  await expect(under).toBeHidden();
  await expect(panel(page).getByRole("group", { name: /^Your answer on / })).toBeVisible();
});
