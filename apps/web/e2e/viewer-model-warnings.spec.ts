import { expect, type Page, test } from "./a11y.ts";

const block = (page: Page) => page.locator('[data-slot="model-warnings"]');

const taskIds = {
  "RT-14": "00000000-0000-4000-8007-000000000014",
  "RT-15": "00000000-0000-4000-8007-000000000015",
};

async function openObjectsTab(page: Page, task: keyof typeof taskIds) {
  await page.goto("/prototype");
  const link = page
    .getByRole("list", { name: "Screens" })
    .getByRole("link", { name: "Full viewer · Objects tab", exact: true });
  const url = new URL((await link.getAttribute("href")) ?? "", page.url());
  url.searchParams.set("task", taskIds[task]);
  if (task === "RT-15") url.pathname = url.pathname.replace(/\d+$/, "000000000004");
  await page.goto(`${url.pathname}${url.search}`);
  await expect(page.getByTestId("full-viewer")).toBeVisible();
  await expect(page.getByText("AI says")).toBeVisible();
}

test("a task whose typer scores under the accuracy floor shows the model warnings block", async ({
  page,
}) => {
  await openObjectsTab(page, "RT-15");
  await expect(block(page).getByRole("heading", { name: "Model warnings" })).toBeVisible();
  await expect(block(page).getByRole("note")).toContainText("HoVer-NeXt typed only 66%");
});

test("a task whose typer passes every rule shows no block", async ({ page }) => {
  await openObjectsTab(page, "RT-14");
  await expect(block(page)).toHaveCount(0);
});
