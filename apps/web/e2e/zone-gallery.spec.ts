import { expect, type Page, test } from "./a11y.ts";

const rt14 = "00000000-0000-4000-8007-000000000014";
const a1 = "00000000-0000-4000-8005-000000000001";
const a2 = "00000000-0000-4000-8005-000000000002";

const panel = (page: Page) => page.getByRole("complementary", { name: "Side panel" });

async function objectsTabUrl(page: Page) {
  await page.goto("/prototype");
  const link = page
    .getByRole("list", { name: "Screens" })
    .getByRole("link", { name: "Full viewer · Objects tab", exact: true });
  return ((await link.getAttribute("href")) ?? "").replace(a1, a2);
}

async function savedDecisions(page: Page) {
  return page.evaluate(
    async ([task, slide]) => {
      const response = await fetch(`/api/review-tasks/${task}/slides/${slide}/verdicts`);
      const body = (await response.json()) as { items?: { object: string; value: string }[] };
      return body.items ?? (body as unknown as { object: string; value: string }[]);
    },
    [rt14, a2],
  );
}

const tiles = (page: Page) =>
  panel(page)
    .getByRole("group", { name: /^Unsure cells in/ })
    .getByRole("button");

test("a zone is gone through by mouse and every decision is saved", async ({ page }) => {
  await page.goto(await objectsTabUrl(page));
  await panel(page)
    .getByRole("list", { name: "Zones where the AI is unsure" })
    .getByRole("button", { name: /Zone 2/ })
    .click();
  const count = await tiles(page).count();
  expect(count).toBeGreaterThan(1);
  await tiles(page).first().click();
  await expect(page).toHaveURL(/object=/);
  await page.getByTestId("cell-type-bar").getByRole("button", { name: /Keep/ }).click();
  await expect(page.getByText(/: agree$/).first()).toBeVisible();
  await panel(page)
    .getByRole("button", { name: /Rest look right/ })
    .click();
  await expect(page.getByText(/cells in .* marked agree/)).toBeVisible();
  await expect(panel(page).getByRole("button", { name: /Rest look right/ })).toBeDisabled();
  await expect(tiles(page).first()).toHaveAttribute("data-decision", "agree");
  const decided = await savedDecisions(page);
  const agreed = decided.filter((item) => item.value === "agree");
  expect(agreed.length).toBeGreaterThanOrEqual(count);
});

test("a zone is gone through by keyboard and every decision is saved", async ({ page }) => {
  await page.goto(await objectsTabUrl(page));
  await panel(page)
    .getByRole("list", { name: "Zones where the AI is unsure" })
    .getByRole("button", { name: /Zone 1/ })
    .click();
  const count = await tiles(page).count();
  expect(count).toBeGreaterThan(2);
  await page.keyboard.press("j");
  await expect(page).toHaveURL(/object=/);
  const first = new URL(page.url()).searchParams.get("object");
  await page.keyboard.press("k");
  await expect(page.getByText(`${first}: agree`)).toBeVisible();
  await page.keyboard.press("j");
  await expect(page).toHaveURL(/object=/);
  expect(new URL(page.url()).searchParams.get("object")).not.toBe(first);
  await page.keyboard.press("u");
  await expect(page.getByText(/: not sure$/)).toBeVisible();
  await page.keyboard.press("Shift+K");
  await expect(page.getByText(/cells in .* marked agree/)).toBeVisible();
  await expect(tiles(page).first()).not.toHaveAttribute("data-decision", "open");
  for (const tile of await tiles(page).all()) {
    await expect(tile).not.toHaveAttribute("data-decision", "open");
  }
  const decided = await savedDecisions(page);
  expect(decided.filter((item) => item.value === "agree").length).toBeGreaterThanOrEqual(count - 1);
  expect(decided.filter((item) => item.value === "unsure")).toHaveLength(1);
});
