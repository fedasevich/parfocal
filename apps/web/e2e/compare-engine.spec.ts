import { expect, type Page, test } from "@playwright/test";

async function openCompare(page: Page) {
  await page.goto("/prototype");
  const link = page
    .getByRole("list", { name: "Screens" })
    .getByRole("link", { name: "Full viewer · Objects tab", exact: true });
  await page.goto((await link.getAttribute("href")) ?? "");
  await page.getByRole("button", { name: /^A1/ }).first().click();
  const slides = page.getByRole("dialog", { name: "Slides in this case and task" });
  await slides
    .getByRole("button", { name: /Side by side with/ })
    .first()
    .click();
  await expect(page).toHaveURL(/scene=picked/);
}

const pane = (page: Page, side: string) => page.locator(`[data-pane="${side}"]`);
const engineOn = (page: Page, side: string) => pane(page, side).getByTestId("still-engine");
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

test("each compare pane is an engine stage on its own real slide", async ({ page }) => {
  test.setTimeout(90_000);
  await openCompare(page);
  for (const side of ["left", "right"]) {
    await expect(engineOn(page, side)).toHaveAttribute("data-state", "ready", { timeout: 20_000 });
    await expect(engineOn(page, side).locator("canvas").first()).toBeVisible();
    await expect(pane(page, side).locator('[data-slot="slide-still"] svg image')).toHaveCount(0);
  }
  const left = await engineOn(page, "left").getAttribute("data-slide");
  const right = await engineOn(page, "right").getAttribute("data-slide");
  expect(left).toBeTruthy();
  expect(right).toBeTruthy();
  expect(left).not.toEqual(right);
  await expect(pane(page, "left").locator("path[stroke='var(--c-tumor)']")).toHaveCount(0);
});

test("compare from the rail of a slide outside any task keeps the workspace and draws both", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const p07 = "00000000-0000-4000-8003-000000000007";
  const a1 = "00000000-0000-4000-8005-000000000001";
  await page.goto(`/projects/${p07}/slides/${a1}?workspace=annotate`);
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
    timeout: 20_000,
  });
  await page.getByTestId("rail-compare").click();
  await expect(page).toHaveURL(/scene=picking/);
  await expect(page).toHaveURL(/workspace=annotate/);
  await expect(page).not.toHaveURL(/task=/);
  await expect(page.getByText("Loading the slide")).toHaveCount(0);

  await page
    .getByRole("listbox", { name: "Slide for the right side" })
    .getByRole("option", { name: /^A2/ })
    .click();
  await expect(pane(page, "right")).toHaveAccessibleName(/^Right: A2/);
  for (const side of ["left", "right"]) {
    await expect(engineOn(page, side)).toHaveAttribute("data-state", "ready", { timeout: 20_000 });
    await expect(engineOn(page, side).locator("canvas").first()).toBeVisible();
  }
  expect(await engineOn(page, "left").getAttribute("data-slide")).toEqual(a1);
  await expect(page).toHaveURL(/scene=picked/);
  await expect(page).toHaveURL(/with=/);
  await expect(page.getByTestId("slide-progress")).toContainText("Comparing 2 slides");
  await expect(page.getByTestId("slide-progress")).not.toContainText("Opening");
  await expect(page.getByText("Cytokeratin, marks tumor cells brown")).toHaveCount(0);
  await expect(page.getByText(/capsule question/)).toHaveCount(0);
  await expect(page.getByText("The slide you were reading")).toBeVisible();

  await page.getByRole("tab", { name: /^Display/ }).click();
  await expect(page).not.toHaveURL(/scene=/);
  await expect(page).toHaveURL(/workspace=annotate/);
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
    timeout: 20_000,
  });
});

test("linked compare panes move both engine cameras and unlinked only the dragged one", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await openCompare(page);
  for (const side of ["left", "right"]) {
    await expect(engineOn(page, side)).toHaveAttribute("data-state", "ready", { timeout: 20_000 });
  }
  const box = await pane(page, "left").boundingBox();
  if (box === null) throw new Error("no left pane");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -400);
  await page.mouse.wheel(0, -400);

  const beforeLeft = await cameraOn(page, "left");
  const beforeRight = await cameraOn(page, "right");
  await drag(page, "left", { x: 120, y: -80 });
  await expect.poll(() => cameraOn(page, "left")).not.toEqual(beforeLeft);
  await expect.poll(() => cameraOn(page, "right")).not.toEqual(beforeRight);

  await page.getByRole("switch", { name: "Linked" }).click();
  const heldRight = await cameraOn(page, "right");
  const movedLeft = await cameraOn(page, "left");
  await drag(page, "left", { x: -100, y: 60 });
  await expect.poll(() => cameraOn(page, "left")).not.toEqual(movedLeft);
  expect(await cameraOn(page, "right")).toEqual(heldRight);
});

test("rotating a compare pane turns its engine stage with the pane", async ({ page }) => {
  test.setTimeout(90_000);
  await openCompare(page);
  const turn = (side: string) => pane(page, side).getByTestId("engine-turn");
  await expect(engineOn(page, "left")).toHaveAttribute("data-state", "ready", { timeout: 20_000 });
  await expect(turn("left")).toHaveAttribute("data-rotation", "0");

  await page.getByRole("button", { name: "Rotate left pane right" }).click();
  await expect(turn("left")).toHaveAttribute("data-rotation", "15");
  await expect(turn("right")).toHaveAttribute("data-rotation", "15");
  await expect(turn("left")).toHaveAttribute("style", /rotate\(15deg\)/);
  const host = await turn("left").evaluate((node) => ({
    width: (node as HTMLElement).offsetWidth,
    paneWidth: node.closest("[data-pane]")?.getBoundingClientRect().width ?? 0,
  }));
  expect(host.width).toBeGreaterThan(host.paneWidth);
  await expect(engineOn(page, "left")).toHaveAttribute("data-state", "ready");
  await expect.poll(() => canvasFillsHost(page, "left")).toBe(true);

  await page.getByRole("switch", { name: "Linked" }).click();
  await page.getByRole("button", { name: "Reset right pane rotation" }).click();
  await expect(turn("right")).toHaveAttribute("data-rotation", "0");
  await expect(turn("left")).toHaveAttribute("data-rotation", "15");
  await expect.poll(() => canvasFillsHost(page, "right")).toBe(true);
});
