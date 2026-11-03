import { expect, type Page, test } from "@playwright/test";

const watchTransitions = (page: Page) =>
  page.evaluate(() => {
    const root = document.documentElement;
    const seen: string[] = [];
    Object.assign(window, { vtSeen: seen });
    root.dataset["motion"] = "presenting";
    new MutationObserver(() => {
      const kind = root.dataset["vt"];
      if (kind) seen.push(kind);
    }).observe(root, { attributes: true, attributeFilter: ["data-vt"] });
  });

const seenKinds = (page: Page) =>
  page.evaluate(() => (window as unknown as { vtSeen: string[] }).vtSeen);

test("opening a slide from My work animates, the pointer reaches the page and a key cuts it", async ({
  page,
}) => {
  await page.goto("/my-work?tab=review");
  await expect(page.getByRole("heading", { name: "My work" })).toBeVisible();
  await watchTransitions(page);
  await page.getByRole("button", { name: /Continue reviewing/ }).click();
  await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]+\/guided\?slide=/);
  const during = await page.evaluate(() => {
    const target = document.querySelector("[data-vt-target]");
    const box = target?.getBoundingClientRect();
    const hit = box
      ? document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
      : null;
    return {
      vt: document.documentElement.dataset["vt"] ?? null,
      reachesPage: hit !== null && hit !== document.documentElement,
    };
  });
  expect(during.vt).toBe("open");
  expect(during.reachesPage).toBe(true);
  await page.keyboard.press("Shift");
  expect(await page.evaluate(() => document.documentElement.dataset["vt"] ?? null)).toBeNull();
  expect(await seenKinds(page)).toEqual(["open"]);
});

test("reduced motion turns the move into a cut", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/my-work?tab=review");
  await expect(page.getByRole("heading", { name: "My work" })).toBeVisible();
  await watchTransitions(page);
  await page.getByRole("button", { name: /Continue reviewing/ }).click();
  await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]+\/guided\?slide=/);
  await expect(page.locator("[data-vt-target]")).toBeVisible();
  expect(await seenKinds(page)).toEqual([]);
});
