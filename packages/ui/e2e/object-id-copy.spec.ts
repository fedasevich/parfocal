import { expect, test } from "@playwright/test";

const story =
  "/iframe.html?id=components-tags--copyable-object-id-tags&viewMode=story&globals=a11y.manual:!true";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

test("clicking an ID tag copies its full path and says so", async ({ page }) => {
  await page.goto(story);
  const tag = page.getByRole("button", { name: "Copy ID P07/S26-04812/A1/T2.C145" });
  await expect(tag).toHaveText("T2·C145");
  await expect(tag).not.toHaveAttribute("data-copied", "true");
  await tag.click();
  await expect(tag).toHaveAttribute("data-copied", "true");
  await expect(page.getByRole("status").first()).toHaveText("Copied P07/S26-04812/A1/T2.C145");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "P07/S26-04812/A1/T2.C145",
  );
});

test("the large tag copies the loose slide path with a tilde", async ({ page }) => {
  await page.goto(story);
  await page.getByRole("button", { name: "Copy ID P07/~/tcga-0042/T2" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("P07/~/tcga-0042/T2");
});

test("the copied mark goes away by itself and the tag keeps its size", async ({ page }) => {
  await page.goto(story);
  const tag = page.getByRole("button", { name: "Copy ID P07/S26-04812/A1/T2.C145" });
  const before = await tag.boundingBox();
  await tag.click();
  await expect(tag).toHaveAttribute("data-copied", "true");
  expect(await tag.boundingBox()).toEqual(before);
  await expect(tag).not.toHaveAttribute("data-copied", "true", { timeout: 8000 });
});
