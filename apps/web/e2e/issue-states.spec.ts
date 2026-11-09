import { expect, test } from "@playwright/test";
import { inPart, parts } from "./parts.ts";

test("the issue states index opens from the prototype index with every flow", async ({ page }) => {
  await page.goto("/prototype");
  await page
    .getByRole("list", { name: "Screens" })
    .getByRole("link", { name: "Issue states" })
    .click();
  await expect(page).toHaveURL(/\/issue-states$/);
  await expect(page.getByRole("heading", { name: "Issue states", level: 1 })).toBeVisible();
  const index = page.getByTestId("issue-states");
  await expect(index.getByRole("region")).toHaveCount(15);
  await expect(index.locator("[data-issue-state]")).toHaveCount(45);
  await expect(index.locator("a[data-state-button]")).toHaveCount(52);
  await expect(index.locator("button[data-state-button][aria-disabled=true]")).toHaveCount(0);
});

for (const part of parts) {
  test(`every enabled button reaches its screen in its scene and never the not found page, part ${part}`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/issue-states");
    const links = page.getByTestId("issue-states").locator("a[data-state-button]");
    await expect(links).toHaveCount(52);
    const targets = await links.evaluateAll((anchors) =>
      anchors.map((anchor) => ({
        key: anchor.getAttribute("data-state-button") ?? "",
        href: anchor.getAttribute("href") ?? "",
      })),
    );
    for (const { key, href } of inPart(targets, part)) {
      const scene = key.split(":")[1] ?? "";
      expect(new URL(href, "http://localhost").searchParams.get("scene"), key).toBe(scene);
      await page.goto(href);
      await expect(page.locator("main, [role=dialog], h1, h2").first(), key).toBeVisible();
      await expect(page.getByRole("heading", { name: "Page not found" }), key).toHaveCount(0);
      await expect(page.getByText(/^Placeholder\. The screen is built by/), key).toHaveCount(0);
    }
    expect(errors).toEqual([]);
  });
}

test("Show opens the state as its persona and Back to the index returns", async ({ page }) => {
  await page.goto("/issue-states");
  await page.locator('a[data-state-button="team:overdue"]').click();
  await expect(page).toHaveURL(/\/team\?scene=overdue&as=DH$/);
  const bar = page.getByTestId("prototype-bar");
  await expect(bar).toContainText("Opened from Issue states");
  await expect(bar.getByTestId("persona-chip")).toContainText("Daniel Hruška");
  await page.getByRole("link", { name: "Back to the index" }).click();
  await expect(page).toHaveURL(/\/issue-states$/);
  await expect(page.getByTestId("prototype-bar")).toHaveCount(0);
});
