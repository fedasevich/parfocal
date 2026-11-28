import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const tumor044 = "00000000-0000-4000-8005-000000000005";
const groupsKey = "parfocal.fake.layer-groups";
const annotationsKey = "parfocal.fake.annotations";
const longFrameMs = 50;

type Box = { x: number; y: number };

async function openSlide(page: Page) {
  await page.goto(`/projects/${p07}?tab=slides`);
  await page
    .getByTestId("slide-row")
    .filter({ hasText: "tumor_044" })
    .getByRole("button", { name: "Open" })
    .click();
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
  await expect(stage).toHaveAttribute("data-annotations", "loaded", { timeout: 15_000 });
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0 };
  return { stage, box };
}

async function drawRectangle(page: Page, box: Box, from: [number, number], to: [number, number]) {
  const stage = page.getByTestId("slide-stage");
  if ((await stage.getAttribute("data-tool")) !== "rectangle") await page.keyboard.press("r");
  await expect(stage).toHaveAttribute("data-tool", "rectangle");
  await page.mouse.move(box.x + from[0], box.y + from[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + to[0], box.y + to[1], { steps: 5 });
  await page.mouse.up();
}

const tree = (page: Page) => page.getByTestId("layers-tree");
const row = (page: Page, key: string) => tree(page).locator(`[data-key="${key}"]`);
const shapeRows = (page: Page) => tree(page).locator('[data-kind="shape"]');
const classRow = (page: Page) => tree(page).locator('[data-key^="c:"]').first();
const named = (page: Page, name: string) =>
  tree(page).locator('[data-kind="group"]', { hasText: name });

async function centreOf(page: Page, key: string) {
  const box = await row(page, key).boundingBox();
  if (box === null) throw new Error(`row ${key} is not on screen`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test("a row selects its shape, Cmd+G groups, rows drag into the group and the tree is kept", async ({
  page,
}) => {
  const { box, stage } = await openSlide(page);
  await drawRectangle(page, box, [200, 200], [300, 260]);
  await drawRectangle(page, box, [400, 200], [500, 260]);
  await drawRectangle(page, box, [200, 400], [300, 460]);
  await expect(page.getByTestId("polygon-shape")).toHaveCount(3);
  await expect(classRow(page)).toContainText("3");
  await expect(shapeRows(page)).toHaveCount(0);

  await classRow(page)
    .getByRole("button", { name: /^Expand / })
    .click();
  await expect(shapeRows(page)).toHaveCount(3);
  const [first, second, third] = await shapeRows(page).evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("data-key") ?? ""),
  );
  const idOf = (key: string | undefined) => (key ?? "").slice(2);

  await row(page, first ?? "")
    .getByTestId("layers-row-name")
    .click();
  await expect(stage).toHaveAttribute("data-tool", "select");
  await expect(page.getByTestId("select-layer")).toHaveAttribute("data-selected", idOf(first));
  await expect(row(page, first ?? "")).toHaveAttribute("data-selected", "true");

  await page.keyboard.press("Control+g");
  await expect(named(page, "Group 1")).toContainText("1");
  await expect(named(page, "Group 1")).toHaveAttribute("data-expanded", "true");

  await row(page, second ?? "")
    .getByTestId("layers-row-name")
    .click();
  await row(page, third ?? "")
    .getByTestId("layers-row-name")
    .click({ modifiers: ["Shift"] });
  await expect(page.getByTestId("select-layer")).toHaveAttribute(
    "data-selected",
    `${idOf(second)},${idOf(third)}`,
  );

  const from = await centreOf(page, second ?? "");
  const groupKey = (await named(page, "Group 1").getAttribute("data-key")) ?? "";
  const to = await centreOf(page, groupKey);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x, from.y - 10, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await expect(row(page, groupKey)).toHaveAttribute("data-drop", "into");
  await page.mouse.up();
  await expect(named(page, "Group 1")).toContainText("3");
  await expect(tree(page).locator('[data-key^="c:"]')).toHaveCount(0);

  await row(page, groupKey).getByRole("button", { name: "Collapse Group 1" }).click();
  await expect(row(page, groupKey)).toHaveAttribute("data-expanded", "false");
  await expect(shapeRows(page)).toHaveCount(0);
  await row(page, groupKey).getByTestId("layers-row-name").dblclick();
  await page.getByLabel("Name of Group 1").fill("Margins");
  await page.keyboard.press("Enter");
  await expect(named(page, "Margins")).toContainText("3");

  await expect
    .poll(() => page.evaluate((key) => sessionStorage.getItem(key) ?? "", groupsKey))
    .toContain("Margins");
  await page.reload();
  await expect(stage).toHaveAttribute("data-annotations", "loaded", { timeout: 15_000 });
  await expect(named(page, "Margins")).toContainText("3");
  await expect(named(page, "Margins")).toHaveAttribute("data-expanded", "false");
  await expect(tree(page).locator('[data-key^="c:"]')).toHaveCount(0);
  await expect(page.getByTestId("polygon-shape")).toHaveCount(3);
});

test("a list of 5000 cells scrolls without a long frame", async ({ page }) => {
  test.setTimeout(90_000);
  await page.addInitScript(
    ({ key, slide, count }) => {
      if (sessionStorage.getItem(key) !== null) return;
      const stamp = new Date(0).toISOString();
      const cells = Array.from({ length: count }, (_, index) => ({
        id: `00000000-0000-4000-9000-${String(index).padStart(12, "0")}`,
        slide_id: slide,
        kind: "cell",
        number: index + 1,
        code: `C${index + 1}+`,
        geometry: { type: "Point", coordinates: [1000 + (index % 100) * 40, 1000 + index] },
        class_id: null,
        text: null,
        task_id: null,
        version: 1,
        created_by_user_id: null,
        created_at: stamp,
        updated_at: stamp,
        deleted_at: null,
      }));
      sessionStorage.setItem(key, JSON.stringify({ [slide]: cells }));
    },
    { key: annotationsKey, slide: tumor044, count: 5000 },
  );
  await openSlide(page);
  await expect(classRow(page)).toContainText("5000");
  await classRow(page)
    .getByRole("button", { name: /^Expand / })
    .click();
  await expect(tree(page)).toHaveAttribute("data-rows", "5001");
  expect(await tree(page).locator("li").count()).toBeLessThan(60);

  await page.evaluate(() => {
    const watch = { longest: 0, longFrames: 0 };
    Object.assign(window, { treeWatch: watch });
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        watch.longest = Math.max(watch.longest, entry.duration);
        if (entry.duration > 50) watch.longFrames += 1;
      }
    });
    observer.observe({ type: "longtask" });
    Object.assign(window, {
      stopTreeWatch: () => {
        observer.disconnect();
        return watch;
      },
    });
  });
  const scroller = await page.getByTestId("stage-inspector").boundingBox();
  if (scroller === null) throw new Error("the panel is not on screen");
  await page.mouse.move(scroller.x + scroller.width / 2, scroller.y + scroller.height / 2);
  for (let step = 0; step < 40; step++) await page.mouse.wheel(0, 600);
  await expect
    .poll(() =>
      tree(page).evaluate((node) => {
        for (let up = node.parentElement; up !== null; up = up.parentElement) {
          const { overflowY } = window.getComputedStyle(up);
          if (overflowY === "auto" || overflowY === "scroll") return up.scrollTop;
        }
        return node.scrollTop;
      }),
    )
    .toBeGreaterThan(20_000);
  await expect(tree(page).locator("li").last()).toBeVisible();
  const watch = await page.evaluate(() =>
    (
      window as unknown as { stopTreeWatch: () => { longest: number; longFrames: number } }
    ).stopTreeWatch(),
  );
  console.log(`layers tree scroll: ${JSON.stringify(watch)}`);
  expect(watch.longest).toBeLessThanOrEqual(longFrameMs);
  expect(watch.longFrames).toBe(0);
});

for (const width of [340, 280]) {
  test(`a shape row with a long measure keeps a clickable name at a ${width} px panel`, async ({
    page,
  }) => {
    const { box, stage } = await openSlide(page);
    await drawRectangle(page, box, [100, 100], [700, 500]);
    await expect(page.getByTestId("polygon-shape")).toHaveCount(1);
    await classRow(page)
      .getByRole("button", { name: /^Expand / })
      .click();
    await expect(shapeRows(page)).toHaveCount(1);

    const panel = page.getByRole("complementary", { name: "Side panel" });
    const handle = page.getByRole("separator", { name: "Resize the side panel" });
    const handleBox = await handle.boundingBox();
    if (handleBox === null) throw new Error("no resize handle");
    const viewport = page.viewportSize()?.width ?? 1280;
    const y = handleBox.y + handleBox.height / 2;
    await page.mouse.move(handleBox.x + handleBox.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(viewport - width, y, { steps: 6 });
    await page.mouse.up();
    await expect.poll(async () => Math.round((await panel.boundingBox())?.width ?? 0)).toBe(width);

    const shapeRow = shapeRows(page).first();
    const measure = (await shapeRow.getByTestId("layers-row-measure").textContent()) ?? "";
    expect(measure.length).toBeGreaterThan(12);
    const name = shapeRow.getByTestId("layers-row-name");
    const nameBox = await name.boundingBox();
    expect(nameBox?.width ?? 0).toBeGreaterThanOrEqual(48);
    await expect(name).toContainText(/\S/);
    await name.click();
    await expect(page.getByTestId("select-layer")).toHaveAttribute(
      "data-selected",
      (await shapeRow.getAttribute("data-key"))?.slice(2) ?? "",
    );
    await expect(stage).toHaveAttribute("data-tool", "select");
  });
}
