import { expect, type Page, test } from "@playwright/test";
import { stillEngineOn as engineOn, openCompare, comparePane as pane } from "./compare-open.ts";

const cameraOn = (page: Page, side: string) => engineOn(page, side).getAttribute("data-camera");

const canvasFillsHost = (page: Page, side: string) =>
  pane(page, side)
    .getByTestId("engine-turn")
    .evaluate((host) => {
      const canvas = host.querySelector("canvas");
      const turned = host as HTMLElement;
      return (
        canvas !== null &&
        Math.abs(canvas.clientWidth - turned.offsetWidth) <= 1 &&
        Math.abs(canvas.clientHeight - turned.offsetHeight) <= 1
      );
    });

async function drag(page: Page, side: string, by: { x: number; y: number }) {
  const box = await pane(page, side).boundingBox();
  if (box === null) throw new Error(`no ${side} pane`);
  const from = { x: box.x + box.width * 0.4, y: box.y + box.height * 0.6 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + by.x, from.y + by.y, { steps: 6 });
  await page.mouse.up();
}

test("compare keeps the live engine stage on the left and draws the other slide on the right", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await openCompare(page);
  await expect(pane(page, "left")).toHaveAttribute("data-testid", "slide-stage");
  await expect(engineOn(page, "right")).toHaveAttribute("data-state", "ready", {
    timeout: 20_000,
  });
  await expect(engineOn(page, "right").locator("canvas").first()).toBeVisible();
  await expect(engineOn(page, "left")).toHaveCount(0);
  await expect(page.getByTestId("rail-compare")).toHaveAttribute("aria-pressed", "true");
});

test("compare from the rail of a slide outside any task keeps the mode, its rail and its tabs", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const p07 = "00000000-0000-4000-8003-000000000007";
  const a1 = "00000000-0000-4000-8005-000000000001";
  await page.goto(`/projects/${p07}/slides/${a1}?mode=annotate`);
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
    timeout: 20_000,
  });
  const railBefore = await page.locator("[data-slot='tool-rail-button']").count();
  await page.getByTestId("rail-compare").click();
  await expect(page).toHaveURL(/layout=compare/);
  await expect(page).toHaveURL(/mode=annotate/);
  await expect(page).not.toHaveURL(/task=/);
  await expect(page).not.toHaveURL(/scene=/);

  await page
    .getByRole("listbox", { name: "Slide for the right side" })
    .getByRole("option", { name: /^A2/ })
    .click();
  await expect(pane(page, "right")).toHaveAccessibleName(/^Right: A2/);
  await expect(engineOn(page, "right")).toHaveAttribute("data-state", "ready", {
    timeout: 20_000,
  });
  await expect(page).toHaveURL(/with=/);
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-workspace", "annotate");
  await expect(page.locator("[data-slot='tool-rail-button']")).toHaveCount(railBefore);
  await expect(page.locator("[data-compare]")).toHaveAttribute("data-compare", "drawn");

  await page.getByRole("button", { name: "Polygon" }).first().click();
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-tool", "polygon");
  await page.getByRole("tab", { name: /^Display/ }).click();
  await expect(page).toHaveURL(/layout=compare/);
  await expect(page.getByRole("tab", { name: /^Display/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );

  await page.getByTestId("rail-compare").click();
  await expect(page).not.toHaveURL(/layout=/);
  await expect(page).toHaveURL(/mode=annotate/);
  await expect(pane(page, "right")).toHaveCount(0);
});

test("linked compare moves the right pane with the live stage and unlinked leaves it", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await openCompare(page);
  await expect(engineOn(page, "right")).toHaveAttribute("data-state", "ready", {
    timeout: 20_000,
  });
  const beforeRight = await cameraOn(page, "right");
  await drag(page, "left", { x: 120, y: -80 });
  await expect.poll(() => cameraOn(page, "right")).not.toEqual(beforeRight);

  await page.getByRole("switch", { name: "Linked" }).click();
  const heldRight = await cameraOn(page, "right");
  await drag(page, "left", { x: -100, y: 60 });
  await page.waitForTimeout(300);
  expect(await cameraOn(page, "right")).toEqual(heldRight);
});

test("rotating the right compare pane turns its engine stage with the pane", async ({ page }) => {
  test.setTimeout(90_000);
  await openCompare(page);
  const turn = (side: string) => pane(page, side).getByTestId("engine-turn");
  await expect(engineOn(page, "right")).toHaveAttribute("data-state", "ready", {
    timeout: 20_000,
  });
  await expect(turn("right")).toHaveAttribute("data-rotation", "0");

  await page.getByRole("button", { name: "Rotate right pane right" }).click();
  await expect(turn("right")).toHaveAttribute("data-rotation", "15");
  await expect(turn("right")).toHaveAttribute("style", /rotate\(15deg\)/);
  const host = await turn("right").evaluate((node) => ({
    width: (node as HTMLElement).offsetWidth,
    paneWidth: node.closest("[data-pane]")?.getBoundingClientRect().width ?? 0,
  }));
  expect(host.width).toBeGreaterThan(host.paneWidth);
  await expect.poll(() => canvasFillsHost(page, "right")).toBe(true);

  await page.getByRole("button", { name: "Reset right pane rotation" }).click();
  await expect(turn("right")).toHaveAttribute("data-rotation", "0");
});
