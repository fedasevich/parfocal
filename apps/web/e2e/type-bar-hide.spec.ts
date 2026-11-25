import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const rt14 = "00000000-0000-4000-8007-000000000014";
const cellsSlide = "00000000-0000-4000-8005-000000000008";
const margin = 24;

test.use({ viewport: { width: 1440, height: 900 } });

const bar = (page: Page) => page.getByTestId("cell-type-bar");
const hint = (page: Page) => page.getByTestId("cell-type-hint");

async function openCell(page: Page) {
  await page.goto(`/projects/${p07}/slides/${cellsSlide}?task=${rt14}&object=C2`);
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
    timeout: 20_000,
  });
  await expect(page.getByTestId("stage-review-objects")).toHaveAttribute("data-current", "C2");
}

type Box = { left: number; top: number; right: number; bottom: number };

async function boxes(page: Page, testId: string): Promise<{ cell: Box; shown: Box; frame: Box }> {
  return page.getByTestId("cell-type-frame").evaluate((frame, id) => {
    const origin = frame.getBoundingClientRect();
    const [left = 0, top = 0, right = 0, bottom = 0] = (frame.getAttribute("data-cell-box") ?? "")
      .split(",")
      .map(Number);
    const shown = frame.querySelector(`[data-testid="${id}"]`)?.getBoundingClientRect();
    return {
      cell: { left, top, right, bottom },
      shown: {
        left: (shown?.left ?? 0) - origin.left,
        top: (shown?.top ?? 0) - origin.top,
        right: (shown?.right ?? 0) - origin.left,
        bottom: (shown?.bottom ?? 0) - origin.top,
      },
      frame: { left: 0, top: 0, right: origin.width, bottom: origin.height },
    };
  }, testId);
}

function clearOfCell({ cell, shown, frame }: { cell: Box; shown: Box; frame: Box }) {
  const above = shown.bottom <= cell.top - margin + 1;
  const below = shown.top >= cell.bottom + margin - 1;
  const leftOf = shown.right <= cell.left - margin + 1;
  const rightOf = shown.left >= cell.right + margin - 1;
  expect(above || below || leftOf || rightOf).toBe(true);
  expect(shown.left).toBeGreaterThanOrEqual(frame.left);
  expect(shown.right).toBeLessThanOrEqual(frame.right);
  expect(shown.top).toBeGreaterThanOrEqual(frame.top);
  expect(shown.bottom).toBeLessThanOrEqual(frame.bottom);
}

test("the type bar hides with its key, the type keys still decide, and a reload keeps it hidden", async ({
  page,
}) => {
  await openCell(page);
  await expect(bar(page)).toBeVisible();
  await expect(hint(page)).toHaveCount(0);
  await page.keyboard.press("Shift+B");
  await expect(bar(page)).toHaveCount(0);
  await expect(hint(page)).toBeVisible();
  await expect(hint(page)).toContainText("Agree");
  await expect(hint(page)).toContainText("Disagree");
  const put = page.waitForRequest(
    (request) => request.method() === "PUT" && request.url().includes("/decisions/C2"),
  );
  await page.keyboard.press("k");
  await put;
  await expect(
    page.getByTestId("stage-review-objects").getByTestId("object-row-cells"),
  ).toContainText("1 of 3 decided");
  await expect(bar(page)).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
    timeout: 20_000,
  });
  await expect(hint(page)).toBeVisible();
  await expect(bar(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Show the type bar" }).click();
  await expect(bar(page)).toBeVisible();
  await page.reload();
  await expect(bar(page)).toBeVisible();
  await expect(hint(page)).toHaveCount(0);
  await bar(page).getByRole("button", { name: "Hide the type bar" }).click();
  await expect(hint(page)).toBeVisible();
});

const inset = 120;

const edges = [
  {
    name: "right",
    move: (cell: Box, frame: Box) => ({ x: frame.right - inset - cell.right, y: 0 }),
  },
  { name: "left", move: (cell: Box) => ({ x: inset - cell.left, y: 0 }) },
  {
    name: "bottom",
    move: (cell: Box, frame: Box) => ({ x: 0, y: frame.bottom - inset - cell.bottom }),
  },
  { name: "top", move: (cell: Box) => ({ x: 0, y: inset - cell.top }) },
];

async function settled(page: Page) {
  let last = "";
  await expect
    .poll(async () => {
      await page.waitForTimeout(250);
      const now = (await page.getByTestId("slide-host").getAttribute("data-camera")) ?? "";
      const still = now === last;
      last = now;
      return still;
    })
    .toBe(true);
}

async function dragBy(page: Page, move: { x: number; y: number }) {
  const stage = await page.getByTestId("cell-type-frame").boundingBox();
  if (!stage) throw new Error("no stage");
  const fromX = move.y === 0 ? stage.x + stage.width / 2 - move.x / 2 : stage.x + 60;
  const fromY = move.y === 0 ? stage.y + 60 : stage.y + stage.height / 2 - move.y / 2;
  await page.mouse.move(fromX, fromY);
  await page.mouse.down();
  await page.mouse.move(fromX + move.x, fromY + move.y, { steps: 12 });
  await page.waitForTimeout(200);
  await page.mouse.up();
}

for (const edge of edges)
  test(`the shown bar keeps clear of a cell near the ${edge.name} edge`, async ({ page }) => {
    await openCell(page);
    await expect(bar(page)).toBeVisible();
    clearOfCell(await boxes(page, "cell-type-bar"));
    for (let press = 0; press < 3; press += 1) await page.keyboard.press("+");
    await settled(page);
    let near = await boxes(page, "cell-type-bar");
    for (let round = 0; round < 6; round += 1) {
      const wanted = edge.move(near.cell, near.frame);
      if (Math.abs(wanted.x) < 40 && Math.abs(wanted.y) < 40) break;
      await dragBy(page, { x: wanted.x / 1.4, y: wanted.y / 1.4 });
      await settled(page);
      near = await boxes(page, "cell-type-bar");
    }
    const left = edge.move(near.cell, near.frame);
    expect(Math.abs(left.x)).toBeLessThan(60);
    expect(Math.abs(left.y)).toBeLessThan(60);
    clearOfCell(near);
    await page.keyboard.press("Shift+B");
    await expect(hint(page)).toBeVisible();
    clearOfCell(await boxes(page, "cell-type-hint"));
  });
