import { expect, type Page, test } from "@playwright/test";

test.setTimeout(90_000);

const p07 = "00000000-0000-4000-8003-000000000007";

const corners = [
  [0, 0],
  [120, 10],
  [100, 100],
  [10, 90],
] as const;

type Stored = { version: number; geometry: { coordinates: number[][][] } };

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

async function drawSquare(page: Page, origin: { x: number; y: number }) {
  await page.keyboard.press("p");
  for (const [x, y] of corners) await page.mouse.click(origin.x + x, origin.y + y);
  await page.mouse.click(origin.x + corners[0][0] + 2, origin.y + corners[0][1] + 1);
}

const saved = (page: Page) =>
  page.evaluate(() => {
    const store = JSON.parse(sessionStorage.getItem("parfocal.fake.annotations") ?? "{}") as Record<
      string,
      Stored[]
    >;
    const only = Object.values(store).flat()[0];
    return { version: only?.version ?? 0, first: only?.geometry.coordinates[0]?.[0]?.[0] ?? 0 };
  });

const colleagueMovesIt = (page: Page) =>
  page.evaluate(() => {
    const key = "parfocal.fake.annotations";
    const store = JSON.parse(sessionStorage.getItem(key) ?? "{}") as Record<string, Stored[]>;
    for (const list of Object.values(store)) {
      for (const item of list) {
        item.version += 1;
        item.geometry.coordinates = item.geometry.coordinates.map((ring) =>
          ring.map(([x, y]) => [(x ?? 0) + 5000, y ?? 0]),
        );
      }
    }
    sessionStorage.setItem(key, JSON.stringify(store));
  });

async function conflictOver(page: Page) {
  const stage = await openSlide(page);
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0, width: 800, height: 600 };
  const origin = { x: box.x + 300, y: box.y + 200 };
  await drawSquare(page, origin);
  await expect(page.getByTestId("polygon-shape")).toHaveCount(1);
  await expect(stage).toHaveAttribute("data-save-state", "saved");
  await colleagueMovesIt(page);
  await page.keyboard.press("v");
  await page.mouse.click(origin.x + 60, origin.y + 50);
  await page.mouse.move(origin.x + 60, origin.y + 50);
  await page.mouse.down();
  await page.mouse.move(origin.x + 120, origin.y + 90, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByTestId("conflict-notice")).toBeVisible();
  await expect(stage).toHaveAttribute("data-save-state", "conflict");
  await expect(page.getByTestId("conflict-notice")).toContainText(
    "A colleague changed the shape you changed",
  );
  await expect(page.getByTestId("conflict-preview")).toBeVisible();
  return stage;
}

test("moving a shape a colleague also changed shows both versions and keep theirs adopts the colleague's", async ({
  page,
}) => {
  const stage = await conflictOver(page);
  const colleague = await saved(page);
  expect(colleague.version).toBe(2);
  await page.getByRole("button", { name: "Keep theirs" }).click();
  await expect(page.getByTestId("conflict-notice")).toHaveCount(0);
  await expect(stage).toHaveAttribute("data-save-state", "saved");
  expect(await saved(page)).toEqual(colleague);
  await expect(page.getByTestId("save-status")).toHaveText("All edits saved");
});

test("keep mine saves the expert's move over the colleague's version", async ({ page }) => {
  const stage = await conflictOver(page);
  const colleague = await saved(page);
  await page.getByRole("button", { name: "Keep mine" }).click();
  await expect(page.getByTestId("conflict-notice")).toHaveCount(0);
  await expect(stage).toHaveAttribute("data-save-state", "saved");
  const mine = await saved(page);
  expect(mine.version).toBe(3);
  expect(mine.first).toBeLessThan(colleague.first);
});
