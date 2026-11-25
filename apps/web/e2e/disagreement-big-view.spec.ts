import { expect, type Locator, type Page, test } from "./a11y.ts";

const rt14 = "00000000-0000-4000-8007-000000000014";
const base = `/tasks/${rt14}`;

const objectStage = (page: Page) => page.getByTestId("object-stage");

async function slideReady(page: Page, object: string) {
  const stage = objectStage(page);
  await expect(stage).toHaveAttribute("data-object", object);
  await expect(stage.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
    timeout: 20_000,
  });
  await expect(stage.getByTestId("object-frame")).toHaveAttribute("data-object", object);
}

type Box = { x: number; y: number; width: number; height: number };

const right = (box: Box) => box.x + box.width;
const bottom = (box: Box) => box.y + box.height;

const apart = (a: Box, b: Box) =>
  right(a) <= b.x + 0.5 ||
  right(b) <= a.x + 0.5 ||
  bottom(a) <= b.y + 0.5 ||
  bottom(b) <= a.y + 0.5;

const inside = (inner: Box, outer: Box) =>
  inner.x >= outer.x - 0.5 &&
  right(inner) <= right(outer) + 0.5 &&
  inner.y >= outer.y - 0.5 &&
  bottom(inner) <= bottom(outer) + 0.5;

async function boxOf(target: Locator): Promise<Box> {
  const box = await target.boundingBox();
  if (box === null) throw new Error("nothing to measure");
  return box;
}

async function barFits(page: Page, frame: Locator) {
  const bar = page.getByTestId("magnification-bar");
  await expect(bar).toBeVisible();
  await bar.hover();
  await expect(bar).toHaveAttribute("data-open", "true");
  await expect(bar.locator('[data-part="scale"]')).toBeVisible();
  await page.waitForTimeout(600);
  const barBox = await boxOf(bar);
  expect(inside(barBox, await boxOf(frame))).toBe(true);
  const shown = bar.locator("button, [data-part='scale'], [data-part='readout'] > span:last-child");
  const boxes: Box[] = [];
  for (const part of await shown.all()) {
    if (!(await part.isVisible())) continue;
    const box = await part.boundingBox();
    if (box === null || box.width === 0) continue;
    expect(inside(box, barBox)).toBe(true);
    boxes.push(box);
  }
  expect(boxes.length).toBeGreaterThan(0);
  for (const [index, first] of boxes.entries()) {
    for (const second of boxes.slice(index + 1)) expect(apart(first, second)).toBe(true);
  }
  const overflow = await bar.evaluate((element) => element.scrollWidth - element.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  return boxes.length;
}

test("the slide opens bigger from a queue row, keeps the outlines and the Decide panel, and decide returns to the next row", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${base}/disagreements?stage=open`);
  await page.getByRole("button", { name: /^T5 / }).click();
  await slideReady(page, "T5");
  const small = await boxOf(objectStage(page));
  const body = page.getByTestId("queue-body");
  await expect(body).not.toHaveAttribute("data-expanded", /.*/);
  await page.getByTestId("queue-expand").click();
  await expect(body).toHaveAttribute("data-expanded", "true");
  await slideReady(page, "T5");
  const big = await boxOf(objectStage(page));
  expect(big.width).toBeGreaterThan(small.width * 1.6);
  expect(big.height).toBeGreaterThan(small.height * 1.5);
  const frame = objectStage(page).getByTestId("object-frame");
  await expect(frame).toHaveAttribute("data-outlines", "2");
  await expect(frame).toHaveAttribute("data-drawn", "3");
  const decide = page.getByRole("complementary", { name: "Decide" });
  await expect(decide).toBeVisible();
  expect(inside(await boxOf(decide), { x: 0, y: 0, width: 1440, height: 900 })).toBe(true);
  await expect(body.getByRole("button", { name: /^T4 / })).toBeHidden();
  await barFits(page, objectStage(page));
  await decide.getByRole("button", { name: /Agree/ }).click();
  await expect(body).not.toHaveAttribute("data-expanded", /.*/);
  await expect(page.getByRole("button", { name: /^T5 / })).toBeVisible();
  await expect(objectStage(page)).not.toHaveAttribute("data-object", "T5");
  const next = await objectStage(page).getAttribute("data-object");
  await expect(page.getByRole("button", { name: new RegExp(`^${next} `) })).toHaveAttribute(
    "aria-current",
    "true",
  );
});

test("Back to the queue and Escape return from the bigger view to the same row", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${base}/disagreements?stage=open`);
  await page.getByRole("button", { name: /^T5 / }).click();
  const body = page.getByTestId("queue-body");
  const toggle = page.getByTestId("queue-expand");
  await toggle.click();
  await expect(body).toHaveAttribute("data-expanded", "true");
  await expect(toggle).toHaveText("Back to the queue");
  await toggle.click();
  await expect(body).not.toHaveAttribute("data-expanded", /.*/);
  await expect(objectStage(page)).toHaveAttribute("data-object", "T5");
  await toggle.click();
  await expect(body).toHaveAttribute("data-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(body).not.toHaveAttribute("data-expanded", /.*/);
  await expect(objectStage(page)).toHaveAttribute("data-object", "T5");
});

for (const size of [
  { name: "the queue", width: 1440, height: 900 },
  { name: "a wide window", width: 1920, height: 1000 },
]) {
  test(`the magnification bar has no overlapping or clipped part in ${size.name}`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    await page.goto(`${base}/disagreements?stage=open`);
    await slideReady(page, "T2");
    await barFits(page, objectStage(page));
  });
}

test("the magnification bar drops parts in order and never overlaps in a stage from 760 px down to 240 px", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${base}/disagreements?stage=open`);
  await slideReady(page, "T2");
  const reference = (await boxOf(objectStage(page))).width;
  const counts: number[] = [];
  for (const stageWidth of [760, 560, 460, 360, 300, 240]) {
    await page.setViewportSize({ width: Math.round(1440 - reference + stageWidth), height: 900 });
    await page.mouse.move(2, 2);
    expect(Math.abs((await boxOf(objectStage(page))).width - stageWidth)).toBeLessThan(2);
    counts.push(await barFits(page, objectStage(page)));
  }
  expect(counts[counts.length - 1] ?? 0).toBeLessThan(counts[0] ?? 0);
  expect(counts).toEqual([...counts].sort((a, b) => b - a));
});
