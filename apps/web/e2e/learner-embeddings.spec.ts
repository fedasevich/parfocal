import { expect, type Page, test } from "./a11y.ts";

const a1 = "00000000-0000-4000-8005-000000000001";
const a2 = "00000000-0000-4000-8005-000000000002";
const cells = 250_000;
const retypes = 10;

test.describe.configure({ timeout: 240_000 });
test.use({ viewport: { width: 1280, height: 900 } });

const panel = (page: Page) => page.getByRole("complementary", { name: "Side panel" });
const slot = (page: Page, name: string) => panel(page).locator(`[data-slot="${name}"]`);
const currentCell = (page: Page) => new URL(page.url()).searchParams.get("object");

async function pagedUrl(page: Page) {
  await page.goto("/prototype");
  const link = page
    .getByRole("list", { name: "Screens" })
    .getByRole("link", { name: "Full viewer · Objects tab", exact: true });
  const href = ((await link.getAttribute("href")) ?? "").replace(a1, a2);
  return `${href}${href.includes("?") ? "&" : "?"}pagedCells=${cells}`;
}

test("a paged slide gives the learner real embeddings after ten retypes", async ({ page }) => {
  await page.goto(await pagedUrl(page));
  await expect(page.getByTestId("paged-review")).toHaveAttribute("data-ready", "true", {
    timeout: 60_000,
  });
  await panel(page)
    .getByRole("list", { name: "Zones where the AI is unsure" })
    .getByRole("button", { name: /^Zone 1(?!\d)/ })
    .click();
  await page.keyboard.press("j");
  await expect(page).toHaveURL(/object=/);
  await expect(slot(page, "findings-learner")).toHaveCount(0);
  const bar = page.getByTestId("cell-type-bar");
  for (let attempt = 0; attempt < retypes * 2 + 4; attempt++) {
    await expect(bar).toBeVisible();
    const object = currentCell(page);
    await bar.getByRole("button", { name: attempt % 2 === 0 ? /Stroma/ : /Other/ }).click();
    await expect.poll(() => currentCell(page)).not.toBe(object);
  }
  const toZone = panel(page).getByRole("button", { name: /^Back to Zone/ });
  if ((await toZone.count()) > 0) await toZone.click();
  await panel(page)
    .getByRole("button", { name: /^Back to the list/ })
    .click();
  await expect(slot(page, "findings-changed")).toContainText("Changed after your corrections", {
    timeout: 90_000,
  });
  await expect(slot(page, "findings-learner")).toContainText(/\d+ examples/);
});
