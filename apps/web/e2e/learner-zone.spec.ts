import { fixtureTruth } from "../src/screens/viewer/learner-fixture-features.ts";
import { expect, type Page, test } from "./a11y.ts";

const a1 = "00000000-0000-4000-8005-000000000001";
const a2 = "00000000-0000-4000-8005-000000000002";
const corrections = 10;

test.describe.configure({ timeout: 90_000 });

const panel = (page: Page) => page.getByRole("complementary", { name: "Side panel" });
const slot = (page: Page, name: string) => panel(page).locator(`[data-slot="${name}"]`);

async function objectsTabUrl(page: Page) {
  await page.goto("/prototype");
  const link = page
    .getByRole("list", { name: "Screens" })
    .getByRole("link", { name: "Full viewer · Objects tab", exact: true });
  return ((await link.getAttribute("href")) ?? "").replace(a1, a2);
}

async function backToTheList(page: Page) {
  await panel(page)
    .getByRole("button", { name: /Back to the list/ })
    .click();
  await expect(slot(page, "findings-zones")).toBeVisible();
}

const currentCell = (page: Page) => new URL(page.url()).searchParams.get("object");

async function correctOne(page: Page) {
  const bar = page.getByTestId("cell-type-bar");
  await expect(bar).toBeVisible();
  const object = currentCell(page);
  const truth = fixtureTruth(object ?? "");
  expect(truth).not.toBeNull();
  await bar
    .getByRole("button", { name: truth === "Tumor" ? /Keep/ : new RegExp(truth ?? "") })
    .click();
  await expect.poll(() => currentCell(page)).not.toBe(object);
  return truth !== "Tumor";
}

async function correctTen(page: Page) {
  await panel(page)
    .getByRole("list", { name: "Zones where the AI is unsure" })
    .getByRole("button", { name: /Zone 1/ })
    .click();
  await page.keyboard.press("j");
  await expect(page).toHaveURL(/object=/);
  let changed = 0;
  while (changed < corrections) {
    if (await correctOne(page)) changed++;
    if (changed === corrections - 1) {
      await expect(page.getByText(/The typer learned from your/)).toHaveCount(0);
    }
  }
}

test("the changed zone appears after ten corrections and is reviewed like any zone", async ({
  page,
}) => {
  await page.goto(await objectsTabUrl(page));
  await correctTen(page);
  await expect(page.getByText(/The typer learned from your 10 corrections/)).toBeVisible();
  await backToTheList(page);
  const zone = slot(page, "findings-changed");
  await expect(zone).toContainText("Changed after your corrections");
  await expect(slot(page, "findings-learner")).toContainText(/\d+ examples/);
  await zone.locator('[data-slot="findings-zone-row"]').click();
  const tiles = panel(page)
    .getByRole("group", { name: "Cells in Changed after your corrections" })
    .getByRole("button");
  const count = await tiles.count();
  expect(count).toBeGreaterThan(0);
  const first = tiles.first();
  const object = ((await first.getAttribute("aria-label")) ?? "").split(" ")[0];
  await first.click();
  await expect.poll(() => currentCell(page)).toBe(object);
  await page.getByTestId("cell-type-bar").getByRole("button", { name: /Keep/ }).click();
  await expect(
    panel(page).getByRole("button", { name: new RegExp(`^${object} .*agree`) }),
  ).toBeVisible();
  await expect(tiles).toHaveCount(count);
});

test("undo all gives the typer's calls back and forget clears what was learned", async ({
  page,
}) => {
  await page.goto(await objectsTabUrl(page));
  await correctTen(page);
  await backToTheList(page);
  const zone = slot(page, "findings-changed");
  await expect(zone).toBeVisible();
  await zone.getByRole("button", { name: "Undo all" }).click();
  await expect(zone).toHaveCount(0);
  await expect(slot(page, "findings-learner")).toBeVisible();
  await slot(page, "findings-learner").getByRole("button", { name: "Forget" }).click();
  await expect(slot(page, "findings-learner")).toHaveCount(0);
});
