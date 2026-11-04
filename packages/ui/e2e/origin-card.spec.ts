import { expect, test } from "@playwright/test";

const story =
  "/iframe.html?id=components-annotate-task--origin-with-history&viewMode=story&globals=a11y.manual:!true";

test("an AI object shows the model name and version and nobody as the author", async ({ page }) => {
  await page.goto(story);
  const card = page.getByRole("region", { name: "T9 origin and history" });
  await expect(card.locator("[data-slot=origin-mark]")).toHaveAttribute("data-origin", "ai");
  await expect(card.locator("[data-slot=origin-model]")).toHaveText(
    "Made by CAMELYON v1.0, nobody has changed it.",
  );
  await expect(card.locator("[data-slot=origin-author]")).toHaveCount(0);
  await expect(card.getByRole("list", { name: "History" }).getByRole("listitem")).toHaveCount(1);
});

test("an AI object fixed by a named expert shows who edited it and the model", async ({ page }) => {
  await page.goto(story);
  const card = page.getByRole("region", { name: "T5 origin and history" });
  await expect(card.locator("[data-slot=origin-mark]")).toHaveAttribute("data-origin", "ai-edited");
  await expect(card.locator("[data-slot=origin-author]")).toContainText("Edited by");
  await expect(card.locator("[data-slot=origin-author]")).toContainText("Anna Kopecká");
  await expect(card.locator("[data-slot=origin-model]")).toHaveText("Made by CAMELYON v1.0");
  await expect(card.getByRole("list", { name: "History" }).getByRole("listitem")).toHaveText([
    /Made by CAMELYON v1\.0.*10:02/,
    /Moved two points.*10:41/,
    /Opened a thread.*11:05/,
  ]);
});

test("an object drawn by a named expert shows who drew it and no model", async ({ page }) => {
  await page.goto(story);
  const card = page.getByRole("region", { name: "H2 origin and history" });
  await expect(card.locator("[data-slot=origin-mark]")).toHaveAttribute("data-origin", "human");
  await expect(card.locator("[data-slot=origin-author]")).toContainText("Drawn by");
  await expect(card.locator("[data-slot=origin-author]")).toContainText("Simona Marková");
  await expect(card.locator("[data-slot=origin-model]")).toHaveCount(0);
  await expect(card.getByRole("list", { name: "History" }).getByRole("listitem")).toHaveText([
    /Drew the shape.*10:44/,
    /Changed the class.*11:20/,
  ]);
});
