import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";

type Box = { x: number; y: number };

async function openSlide(page: Page) {
  await page.goto(`/projects/${p07}?tab=slides`);
  await page
    .getByTestId("slide-row")
    .filter({ hasText: "tumor_044" })
    .getByRole("button", { name: "Open" })
    .click();
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  await expect(stage).toHaveAttribute("data-annotations", "loaded", { timeout: 15_000 });
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0 };
  return { stage, box };
}

async function drawRectangle(page: Page, box: Box, from: [number, number], to: [number, number]) {
  const stage = page.getByTestId("slide-stage");
  if ((await stage.getAttribute("data-tool")) !== "rectangle") await page.keyboard.press("r");
  await page.mouse.move(box.x + from[0], box.y + from[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + to[0], box.y + to[1], { steps: 5 });
  await page.mouse.up();
}

const tree = (page: Page) => page.getByTestId("layers-tree");
const classRow = (page: Page) => tree(page).locator('[data-key^="c:"]').first();
const shapeRows = (page: Page) => tree(page).locator('[data-kind="shape"]');
const composer = (page: Page) => page.getByTestId("pin-composer");
const cards = (page: Page) => page.locator('[data-slot="thread-card"]');
const marks = (page: Page) => page.locator('[data-slot="comment-anchor"]');
const selection = (page: Page) => page.getByTestId("select-layer");

async function shapeIds(page: Page) {
  const keys = await shapeRows(page).evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("data-key") ?? ""),
  );
  return keys.map((key) => key.slice(2));
}

async function post(page: Page, text: string) {
  await expect(composer(page).getByRole("textbox")).toBeFocused();
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
  await expect(composer(page)).toHaveCount(0);
}

async function drawThree(page: Page, box: Box) {
  await drawRectangle(page, box, [200, 200], [300, 260]);
  await drawRectangle(page, box, [400, 200], [500, 260]);
  await drawRectangle(page, box, [200, 400], [300, 460]);
  await page.keyboard.press("v");
  await expect(page.getByTestId("polygon-shape")).toHaveCount(3);
  await classRow(page)
    .getByRole("button", { name: /^Expand / })
    .click();
  await expect(shapeRows(page)).toHaveCount(3);
  await expect(shapeRows(page).nth(2)).toContainText(/T\d+⁺/, { timeout: 15_000 });
  const labels = await shapeRows(page).evaluateAll((nodes) =>
    nodes.map((node) => node.querySelector('[data-slot="object-id-tag"]')?.textContent ?? ""),
  );
  return labels.map((label) => label.trim());
}

async function leaveFocus(page: Page) {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
}

async function openComments(page: Page) {
  await page.getByRole("tab", { name: /Comments/ }).click();
  await expect(page.getByTestId("stage-comments")).toBeVisible();
}

test("comments anchor to a selected object, a selection, a layer, a region and a clicked shape", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const { box } = await openSlide(page);
  const [first, second] = await drawThree(page, box);
  expect(first).toMatch(/^T\d+⁺$/);
  const ids = await shapeIds(page);

  await leaveFocus(page);
  await page.keyboard.press("Escape");
  await page.keyboard.press("c");
  await page.mouse.move(box.x + 600, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(box.x + 700, box.y + 380, { steps: 6 });
  await page.mouse.up();
  await expect(composer(page)).toHaveAttribute("data-target", "region");
  await post(page, "Empty stroma here");

  await page.mouse.click(box.x + 450, box.y + 230);
  await expect(composer(page)).toHaveAttribute("data-target", "object");
  await expect(page.getByTestId("comment-target")).toContainText(`Comment on ${second}`);
  await expect(composer(page).getByRole("button", { name: "Pin the point instead" })).toBeVisible();
  await post(page, "Dropped on the shape");
  await expect(page.locator('[data-slot="comment-pin"]')).toHaveCount(0);

  await shapeRows(page).first().getByTestId("layers-row-name").click();
  await page.keyboard.press("c");
  await expect(composer(page)).toHaveAttribute("data-target", "object");
  await expect(page.getByTestId("comment-target")).toContainText(`Comment on ${first}`);
  await post(page, "Is this one tumour?");

  await page.keyboard.press("v");
  await classRow(page).getByTestId("layers-row-name").click();
  await page.mouse.click(box.x + 250, box.y + 230, { button: "right" });
  await page.getByRole("menuitem", { name: "Comment on 3 objects" }).click();
  await expect(composer(page)).toHaveAttribute("data-target", "selection");
  await post(page, `These three, see ${second}`);

  await classRow(page).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Comment on this layer" }).click();
  await expect(composer(page)).toHaveAttribute("data-target", "layer");
  await post(page, "The whole class needs a second look");
  await expect(classRow(page)).toHaveAttribute("data-comments", "1");

  await expect(marks(page)).toHaveCount(5);
  await expect(shapeRows(page).nth(1)).toHaveAttribute("data-comments", "1");

  await openComments(page);
  await expect(cards(page)).toHaveCount(5);
  const listed = await cards(page).evaluateAll((nodes) =>
    nodes.map((node) => node.querySelector("button")?.textContent ?? ""),
  );
  expect(listed[0]).toContain("Region");
  expect(listed[0]).toContain("Area");
  expect(listed[1]).toContain(second);
  expect(listed[1]).toContain("Drawn region");
  expect(listed[2]).toContain(first);
  expect(listed[3]).toContain("Selection");
  expect(listed[3]).toContain("3 objects");
  expect(listed[4]).toContain("Class layer");
  expect(listed.join(" ")).not.toContain("Pin");

  await cards(page)
    .nth(2)
    .getByRole("button", { name: `Go to ${first}` })
    .click();
  await expect(selection(page)).toHaveAttribute("data-selected", ids[0] ?? "");
  await cards(page)
    .nth(4)
    .getByRole("button", { name: /^Go to / })
    .click();
  await expect
    .poll(async () =>
      (await selection(page).getAttribute("data-selected"))?.split(",").sort().join(","),
    )
    .toBe([...ids].sort().join(","));
  await cards(page).nth(0).getByRole("button", { name: "Go to Region" }).click();
  await expect(marks(page).and(page.locator('[data-anchor="Region"]'))).toBeInViewport();

  await page.getByRole("tab", { name: /Display/ }).click();
  await shapeRows(page).nth(1).getByTestId("layers-row-comments").click();
  await expect(page.getByTestId("pin-thread")).toContainText("Dropped on the shape");
});

test("an object ID and a layer named in a comment are links that reach them", async ({ page }) => {
  test.setTimeout(90_000);
  const { box } = await openSlide(page);
  const [first, , third] = await drawThree(page, box);
  const layer = (await classRow(page).getByTestId("layers-row-name").textContent())?.trim() ?? "";
  await leaveFocus(page);

  await page.keyboard.press("c");
  await page.mouse.click(box.x + 700, box.y + 500);
  await expect(composer(page)).toHaveAttribute("data-target", "point");
  await page.keyboard.type(`Compare ${third} with `);
  await page.keyboard.type("#");
  await expect(page.getByTestId("reference-picker")).toBeVisible();
  await page.getByRole("option", { name: new RegExp(layer) }).click();
  await page.keyboard.press("Enter");
  await expect(composer(page)).toHaveCount(0);

  await page.locator('[data-slot="comment-pin"]').first().click();
  const thread = page.getByTestId("pin-thread");
  await expect(thread.locator('[data-slot="comment-link"]')).toHaveCount(2);
  await thread.locator('[data-slot="comment-link"]', { hasText: third ?? "" }).click();
  await expect(shapeRows(page).nth(2)).toHaveAttribute("data-selected", "true");
  await expect(shapeRows(page).first()).not.toHaveAttribute("data-selected", "true");

  await page.keyboard.press("Escape");
  await page.keyboard.press("c");
  await page.locator('[data-slot="comment-pin"]').first().click();
  await page
    .getByTestId("pin-thread")
    .locator('[data-slot="comment-link"]', { hasText: `#${layer}` })
    .click();
  await expect(shapeRows(page).first()).toHaveAttribute("data-selected", "true");
  await expect(shapeRows(page).nth(2)).toHaveAttribute("data-selected", "true");
  expect(first).toMatch(/^T\d+⁺$/);

  await openComments(page);
  await expect(cards(page).first().locator('[data-slot="comment-link"]')).toHaveCount(2);
});
