import { expect, type Page, test } from "@playwright/test";

test.describe.configure({ timeout: 150_000 });

async function openViewer(page: Page) {
  await page.goto("/prototype");
  const link = page
    .getByRole("list", { name: "Screens" })
    .getByRole("link", { name: "Full viewer · Objects tab", exact: true });
  const href = (await link.getAttribute("href")) ?? "";
  await page.goto(href);
  await expect(page.getByTestId("full-viewer")).toBeVisible({ timeout: 45_000 });
  return page.getByRole("toolbar", { name: "Tools" });
}

const tools = [
  { name: "Select (V)", key: "v" },
  { name: "Pan (H)", key: "h", url: /tool=hand/ },
  { name: "Measure (L)", key: "l", url: /tool=ruler/ },
  { name: "Comment on an ID (C)", key: "c", url: /tool=comment/ },
] as const;

for (const via of ["click", "key"] as const) {
  test(`each review rail tool is pressed after its ${via}`, async ({ page }) => {
    const rail = await openViewer(page);
    await expect(rail.getByRole("button", { name: "Select (V)" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    for (const tool of [...tools.slice(1), tools[0]]) {
      if (via === "click") await rail.getByRole("button", { name: tool.name }).click();
      else await page.keyboard.press(tool.key);
      await expect(rail.getByRole("button", { name: tool.name })).toHaveAttribute(
        "aria-pressed",
        "true",
        { timeout: 15_000 },
      );
      if ("url" in tool) await expect(page).toHaveURL(tool.url);
      else await expect(page).not.toHaveURL(/tool=/);
    }
  });
}

test("the comment tool opens the comments tab", async ({ page }) => {
  const rail = await openViewer(page);
  await rail.getByRole("button", { name: "Comment on an ID (C)" }).click();
  await expect(page).toHaveURL(/tab=comments/);
});

test("smart select routes to Annotate with smart select picked", async ({ page }) => {
  const rail = await openViewer(page);
  await rail.getByRole("button", { name: "Smart select (S)" }).click();
  await expect(page).toHaveURL(/\/annotate\?.*tool=smart/);
  await expect(
    page.getByRole("toolbar", { name: "Tools" }).getByRole("button", { name: "Smart select (S)" }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("the S key routes to Annotate too", async ({ page }) => {
  await openViewer(page);
  await page.keyboard.press("s");
  await expect(page).toHaveURL(/\/annotate\?.*tool=smart/);
});
