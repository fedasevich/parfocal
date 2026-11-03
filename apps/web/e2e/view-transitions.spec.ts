import { expect, type Page, test } from "@playwright/test";

const watchTransitions = (page: Page) =>
  page.evaluate(() => {
    const root = document.documentElement;
    const seen: string[] = [];
    const moves: string[] = [];
    Object.assign(window, { vtSeen: seen, vtMoves: moves });
    document.addEventListener("pointermove", () => moves.push(root.dataset["vt"] ?? ""), true);
    root.dataset["motion"] = "presenting";
    new MutationObserver(() => {
      const kind = root.dataset["vt"];
      if (kind) seen.push(kind);
    }).observe(root, { attributes: true, attributeFilter: ["data-vt"] });
  });

const movesDuring = (page: Page) =>
  page.evaluate(() => (window as unknown as { vtMoves: string[] }).vtMoves.filter(Boolean));

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
  const waiting = await page.waitForFunction(
    () => {
      const target = document.querySelector<HTMLElement>("[data-vt-target]");
      if (
        document.documentElement.dataset["vt"] === undefined ||
        target?.style.viewTransitionName !== "stage"
      )
        return null;
      const box = target.getBoundingClientRect();
      return {
        vt: document.documentElement.dataset["vt"] ?? null,
        x: box.left + box.width / 2,
        y: box.top + box.height / 2,
      };
    },
    null,
    { polling: "raf" },
  );
  const during = (await waiting.jsonValue()) as { vt: string | null; x: number; y: number };
  expect(during.vt).toBe("open");
  await page.mouse.move(during.x, during.y);
  expect(await movesDuring(page)).toContain("open");
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
