import { expect, type Page, test } from "@playwright/test";

const p07 = "00000000-0000-4000-8003-000000000007";

declare global {
  interface Window {
    __networkDown?: boolean;
  }
}

async function cutableNetwork(page: Page) {
  await page.addInitScript(() => {
    const real = window.fetch.bind(window);
    window.fetch = (input, init) => {
      if (window.__networkDown) return Promise.reject(new TypeError("Failed to fetch"));
      return real(input, init);
    };
  });
}

async function openSlide(page: Page) {
  await page.goto(`/projects/${p07}?tab=slides`);
  await page
    .getByTestId("slide-row")
    .filter({ hasText: "tumor_044" })
    .getByRole("button", { name: "Open" })
    .click();
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
  await expect(stage).toHaveAttribute("data-annotations", "loaded");
  return stage;
}

const corners = [
  [0, 0],
  [120, 10],
  [100, 100],
  [10, 90],
] as const;

async function drawSquare(page: Page, origin: { x: number; y: number }) {
  const stage = page.getByTestId("slide-stage");
  if ((await stage.getAttribute("data-tool")) !== "polygon") await page.keyboard.press("p");
  for (const [x, y] of corners) await page.mouse.click(origin.x + x, origin.y + y);
  await page.mouse.click(origin.x + corners[0][0] + 2, origin.y + corners[0][1] + 1);
}

const guardWarns = (page: Page) =>
  page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });

test("edits made while the network is cut for 30 seconds are all saved once it returns", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await cutableNetwork(page);
  const stage = await openSlide(page);
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0 };
  const shapes = page.getByTestId("polygon-shape");

  await drawSquare(page, { x: box.x + 200, y: box.y + 120 });
  await expect(shapes).toHaveCount(1);
  await expect(stage).toHaveAttribute("data-save-state", "saved");
  await expect(page.getByTestId("save-status")).toHaveText("All edits saved");
  expect(await guardWarns(page)).toBe(false);

  await page.evaluate(() => {
    window.__networkDown = true;
  });
  await drawSquare(page, { x: box.x + 360, y: box.y + 120 });
  await drawSquare(page, { x: box.x + 520, y: box.y + 120 });
  await expect(shapes).toHaveCount(3);
  await expect(stage).toHaveAttribute("data-save-state", "retrying");
  await expect(page.getByTestId("save-status")).toHaveText(
    "Not connected, 2 edits waiting to save",
  );
  expect(await guardWarns(page)).toBe(true);

  await page.waitForTimeout(30_000);
  await expect(stage).toHaveAttribute("data-save-state", "retrying");
  await expect(shapes).toHaveCount(3);

  await page.evaluate(() => {
    window.__networkDown = false;
  });
  await expect(stage).toHaveAttribute("data-save-state", "saved", { timeout: 20_000 });
  expect(await guardWarns(page)).toBe(false);

  await page.reload();
  await expect(stage).toHaveAttribute("data-annotations", "loaded");
  await expect(shapes).toHaveCount(3);
});

test("an edit undone while offline never reaches the server", async ({ page }) => {
  await cutableNetwork(page);
  const stage = await openSlide(page);
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0 };
  const shapes = page.getByTestId("polygon-shape");

  await page.evaluate(() => {
    window.__networkDown = true;
  });
  await drawSquare(page, { x: box.x + 200, y: box.y + 120 });
  await expect(stage).toHaveAttribute("data-save-state", "retrying");
  await page.keyboard.press("Control+z");
  await expect(shapes).toHaveCount(0);
  await expect(stage).toHaveAttribute("data-save-state", "saved");
  expect(await guardWarns(page)).toBe(false);

  await page.evaluate(() => {
    window.__networkDown = false;
  });
  await page.reload();
  await expect(stage).toHaveAttribute("data-annotations", "loaded");
  await expect(shapes).toHaveCount(0);
});
