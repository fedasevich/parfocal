import { expect, type Page, test } from "./a11y.ts";
import {
  barHeight,
  barRows,
  outlineModel,
  pickOutlineModel,
  startBarWatch,
  stopBarWatch,
} from "./outline-model.ts";

const p07 = "00000000-0000-4000-8003-000000000007";

async function openTool(page: Page, key: "s" | "u", best?: string) {
  await page.goto(`/projects/${p07}?tab=slides${best ? `&best=${best}` : ""}`);
  await page
    .getByTestId("slide-row")
    .filter({ hasText: "tumor_044" })
    .getByRole("button", { name: "Open" })
    .click();
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  await expect(stage).toHaveAttribute("data-annotations", "loaded");
  await page.keyboard.press(key);
  await expect(stage).toHaveAttribute("data-tool", key === "s" ? "smart" : "auto");
  await expect(page.getByTestId("context-bar")).toBeVisible();
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0, width: 800, height: 600 };
  return { centre: { x: box.x + box.width / 2, y: box.y + box.height / 2 } };
}

test("the Smart select bar is one row with the first run hints showing under it", async ({
  page,
}) => {
  await openTool(page, "s");
  const hints = page.getByTestId("context-hints");
  await expect(hints).toBeVisible();
  await expect(page.getByTestId("hint-close")).toBeVisible();
  expect(await barRows(page)).toBe(1);
  const bar = (await page.getByTestId("context-bar").boundingBox()) ?? { y: 0, height: 0 };
  const line = (await hints.boundingBox()) ?? { y: 0, height: 0 };
  expect(line.y).toBeGreaterThanOrEqual(bar.y + bar.height);
  expect(bar.height).toBeLessThanOrEqual(50);
  await page.getByTestId("hint-close").click();
  await expect(hints).toHaveCount(0);
  expect(await barRows(page)).toBe(1);
});

test("a stopped Best request keeps the Smart select bar on one row and says the rest in a toast", async ({
  page,
}) => {
  test.slow();
  const { centre } = await openTool(page, "s", "slow");
  await pickOutlineModel(page, "Best");
  const restingRows = await barRows(page);
  const restingHeight = await barHeight(page);
  expect(restingRows).toBe(1);
  await startBarWatch(page, "smart-status");
  await page.mouse.click(centre.x, centre.y);
  await expect(page.getByTestId("gpu-wait")).toBeVisible();
  await expect(page.getByTestId("smart-status")).toHaveAttribute("data-step", "asking-best");
  await page.getByTestId("gpu-wait-cancel").click();
  const stopped =
    "You stopped waiting for Best, Good outlined this view. Click again to ask Best again";
  const toast = page.getByText(stopped);
  await expect(toast).toBeVisible();
  await expect(page.getByTestId("smart-encoder-fallback")).toHaveText("Good used");
  await expect(page.getByTestId("smart-layer")).toHaveAttribute("data-phase", "ready");
  await expect(page.getByTestId("context-bar")).toHaveAttribute("data-mode", "proposals");
  await expect(page.getByTestId("context-bar")).not.toContainText(stopped);
  expect(await barRows(page)).toBe(1);
  const watch = await stopBarWatch(page);
  expect(watch.seen).toBeGreaterThan(0);
  expect(watch.rows, watch.worst).toBe(1);
  expect(watch.height).toBeLessThanOrEqual(restingHeight + 2);
  await expect(toast).toHaveCount(0, { timeout: 10_000 });
});

test("an error from the model is a toast and the Smart select bar keeps its size", async ({
  page,
}) => {
  const { centre } = await openTool(page, "s", "offline");
  await pickOutlineModel(page, "Best");
  const before = await barHeight(page);
  await startBarWatch(page, "smart-encoder-fallback");
  await page.mouse.click(centre.x, centre.y);
  await expect(page.getByText(/Best's GPU is not answering/)).toBeVisible();
  await expect(page.getByTestId("smart-layer")).toHaveAttribute("data-phase", "ready");
  await expect(page.getByTestId("smart-encoder-fallback")).toHaveAttribute(
    "data-reason",
    "offline",
  );
  const watch = await stopBarWatch(page);
  expect(watch.seen).toBeGreaterThan(0);
  expect(watch.rows, watch.worst).toBe(1);
  expect(Math.abs(watch.height - before)).toBeLessThanOrEqual(2);
  expect(Math.abs((await barHeight(page)) - before)).toBeLessThanOrEqual(2);
});

test("the Auto region bar stays on one row while it runs over tiles", async ({ page }) => {
  test.slow();
  const { centre } = await openTool(page, "u");
  await expect(page.getByTestId("context-bar")).toBeVisible();
  const restingHeight = await barHeight(page);
  await startBarWatch(page, "auto-status");
  await page.mouse.move(centre.x - 280, centre.y - 280);
  await page.mouse.down();
  await page.mouse.move(centre.x, centre.y, { steps: 4 });
  await page.mouse.move(centre.x + 280, centre.y + 280, { steps: 4 });
  await page.mouse.up();
  await expect(page.getByTestId("proposal-layer")).toBeVisible();
  await expect(page.getByTestId("auto-layer")).toHaveAttribute("data-running", "false");
  await expect(page.getByTestId("context-bar")).toHaveAttribute("data-mode", "proposals");
  const watch = await stopBarWatch(page);
  expect(watch.seen).toBeGreaterThan(0);
  expect(watch.rows, watch.worst).toBe(1);
  expect(watch.height).toBeLessThanOrEqual(restingHeight + 2);
  expect(await barRows(page)).toBe(1);
  await expect(page.getByTestId("context-bar")).toContainText("found");
});

test("the Smart select proposals bar is one row with Good and with the hover and found words", async ({
  page,
}) => {
  const { centre } = await openTool(page, "s");
  expect(await barRows(page)).toBe(1);
  await page.mouse.click(centre.x, centre.y);
  await expect(page.getByTestId("smart-layer")).toHaveAttribute("data-phase", "ready");
  const bar = page.getByTestId("context-bar");
  await expect(bar).toHaveAttribute("data-mode", "proposals");
  await expect(bar).toContainText("1 found");
  await expect(bar.getByTestId("smart-hover-toggle")).toBeVisible();
  await expect(bar.getByTestId("proposal-discard")).toBeVisible();
  await expect(bar.getByTestId("proposal-accept")).toBeVisible();
  expect(await barRows(page)).toBe(1);
  const box = await bar.boundingBox();
  expect(box?.height ?? 0).toBeLessThanOrEqual(50);
});

test("both bars pick a model from the dropdown and show what each model is", async ({ page }) => {
  await openTool(page, "s");
  await expect(outlineModel(page)).toHaveText("Good");
  await outlineModel(page).click();
  const best = page.getByRole("option", { name: /^Best/ });
  const good = page.getByRole("option", { name: /^Good/ });
  await expect(best).toContainText("The most accurate outlines.");
  await expect(best).toContainText("PathoSAM ViT-L");
  await expect(best).toContainText("Slower");
  await expect(good).toContainText("Runs on this computer, also offline.");
  await expect(good).toContainText("Quicker");
  await best.click();
  await expect(outlineModel(page)).toHaveAttribute("data-tier", "best");
  expect(await barRows(page)).toBe(1);

  await page.keyboard.press("u");
  await expect(page.getByTestId("auto-layer")).toHaveAttribute("data-active", "true");
  await expect(outlineModel(page)).toHaveAttribute("data-tier", "best");
  await outlineModel(page).click();
  await expect(page.getByRole("option", { name: /^Good/ })).toContainText(
    "Runs on this computer, also offline.",
  );
  await page.getByRole("option", { name: /^Good/ }).click();
  await expect(outlineModel(page)).toHaveAttribute("data-tier", "good");
  await expect(page.getByTestId("auto-layer")).toHaveAttribute("data-quality", "fast");
  expect(await barRows(page)).toBe(1);

  await page.keyboard.press("s");
  await expect(outlineModel(page)).toHaveAttribute("data-tier", "good");
});

test("the model picked in the bar is saved for the person, and a saved Best still starts on Good", async ({
  page,
}) => {
  await openTool(page, "s");
  const savedValue = async (name: "Best" | "Good") => {
    const saved = page.waitForResponse(
      (response) =>
        response.request().method() === "PUT" && response.url().endsWith("/api/me/setting-layers"),
    );
    await pickOutlineModel(page, name);
    const body = (await saved).request().postDataJSON() as { values: Record<string, unknown> };
    return body.values["tier_outline"];
  };
  expect(await savedValue("Best")).toBe("best");
  expect(await savedValue("Good")).toBe("good");
  expect(await savedValue("Best")).toBe("best");
  await page.reload();
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-annotations", "loaded", {
    timeout: 15_000,
  });
  await page.keyboard.press("s");
  await expect(outlineModel(page)).toHaveAttribute("data-tier", "good");
});
