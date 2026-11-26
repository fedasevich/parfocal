import { expect, type Page, test } from "./a11y.ts";
import { comparePane, openCompare } from "./compare-open.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const rt14 = "00000000-0000-4000-8007-000000000014";
const cellsSlide = "00000000-0000-4000-8005-000000000008";

test.use({ viewport: { width: 1440, height: 900 } });

const stage = (page: Page) => page.getByTestId("slide-stage");
const composer = (page: Page) => page.getByTestId("pin-composer");
const cards = (page: Page) => page.locator('[data-slot="thread-card"]');
const marks = (page: Page) => page.locator('[data-slot="comment-anchor"]');
const foot = (page: Page) => page.getByTestId("object-foot");

async function openCell(page: Page, object: string) {
  await page.goto(`/projects/${p07}/slides/${cellsSlide}?task=${rt14}&object=${object}`);
  await expect(stage(page)).toHaveAttribute("data-state", "ready", { timeout: 60_000 });
  await expect(foot(page)).toHaveAttribute("data-object", object, { timeout: 15_000 });
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
}

async function post(page: Page, text: string) {
  await expect(composer(page).getByRole("textbox")).toBeFocused();
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
  await expect(composer(page)).toHaveCount(0);
}

async function stageMiddle(page: Page) {
  const box = await stage(page).boundingBox();
  if (box === null) throw new Error("the stage is not on screen");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
}

test("a comment on the current cell is anchored to its ID and shows in its side panel", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await openCell(page, "C2");
  await page.keyboard.press("c");
  await expect(composer(page)).toHaveAttribute("data-target", "object");
  await expect(page.getByTestId("comment-target")).toContainText("Comment on C2");
  await page.keyboard.type("Lymphocyte or not? Compare ");
  await page.keyboard.type("#C3");
  await expect(page.getByTestId("reference-picker")).toBeVisible();
  await page.getByRole("option", { name: /^C3/ }).click();
  await page.keyboard.press("Enter");
  await expect(composer(page)).toHaveCount(0);
  await expect(marks(page)).toHaveCount(1);
  await expect(page.locator('[data-slot="comment-pin"]')).toHaveCount(0);

  await page.getByRole("tab", { name: /Comments/ }).click();
  const card = cards(page).filter({ hasText: "Lymphocyte or not?" });
  await expect(card).toContainText("C2");
  await expect(card).toContainText("Cell");
  await card.locator("button").first().click();
  const notes = page.getByTestId("stage-object-notes");
  await expect(notes).toContainText("Comments on this object");
  await expect(notes).toContainText("Lymphocyte or not?");

  await notes.getByRole("textbox").click();
  await page.keyboard.type("Same as ");
  await page.keyboard.type("#C");
  await expect(page.getByTestId("reference-picker")).toBeVisible();
  await page.getByRole("option", { name: /^C1/ }).click();
  await page.keyboard.press("Enter");
  await expect(notes).toContainText("Same as C1");
  await notes.locator('[data-slot="comment-link"]', { hasText: "C3" }).click();
  await page.getByRole("tab", { name: /Objects/ }).click();
  await expect(foot(page)).toHaveAttribute("data-object", "C3");
});

test("the comment tool on a cell anchors to the cell, and a region lists and reopens", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await openCell(page, "C3");
  await page.keyboard.press("c");
  await expect(composer(page)).toHaveAttribute("data-target", "object");
  await page.keyboard.press("Escape");
  await expect(composer(page)).toHaveCount(0);
  const { x, y, box } = await stageMiddle(page);
  await page.mouse.click(x, y);
  await expect(composer(page)).toHaveAttribute("data-target", "object");
  await expect(page.getByTestId("comment-target")).toContainText("Comment on C3");
  await expect(composer(page).getByRole("button", { name: "Pin the point instead" })).toBeVisible();
  await post(page, "Stroma cell, keep it");
  await page.mouse.click(x, y);
  await expect(composer(page)).toHaveAttribute("data-target", "object");
  await expect(composer(page).getByRole("button", { name: "Pin the point instead" })).toBeVisible();
  await post(page, "Agreed, keep it");
  const replied = page.getByTestId("pin-thread");
  await expect(replied).toContainText("Stroma cell, keep it");
  await expect(replied).toContainText("Agreed, keep it");
  await page.keyboard.press("Escape");
  await expect(replied).toHaveCount(0);

  await page.mouse.move(box.x + 80, box.y + 80);
  await page.mouse.down();
  await page.mouse.move(box.x + 180, box.y + 160, { steps: 6 });
  await page.mouse.up();
  await expect(composer(page)).toHaveAttribute("data-target", "region");
  await post(page, "Empty stroma here");
  await expect(marks(page)).toHaveCount(2);

  await page.getByRole("tab", { name: /Comments/ }).click();
  const listed = await cards(page).evaluateAll((nodes) =>
    nodes.map((node) => node.querySelector("button")?.textContent ?? ""),
  );
  expect(listed.some((text) => text.includes("C3") && text.includes("Cell"))).toBe(true);
  expect(listed.some((text) => text.includes("Region") && text.includes("Area"))).toBe(true);
  expect(listed.join(" ")).not.toContain("Pin");
  await cards(page).filter({ hasText: "Empty stroma here" }).locator("button").first().click();
  await expect(page.getByTestId("pin-thread")).toContainText("Empty stroma here");

  await page.evaluate((to) => {
    const state: unknown = window.history.state;
    const before = (state ?? {}) as Record<string, unknown>;
    const index = Number(before["__TSR_index"] ?? 0) + 1;
    window.history.pushState(
      { ...before, __TSR_index: index, key: "e2e", __TSR_key: "e2e" },
      "",
      to,
    );
    const pushed: unknown = window.history.state;
    window.dispatchEvent(new PopStateEvent("popstate", { state: pushed }));
  }, `/tasks/${rt14}/comments?slide=${cellsSlide}`);
  await expect(page.getByTestId("slide-stage")).toHaveCount(0);
  const region = cards(page).filter({ hasText: "Empty stroma here" });
  await expect(region).toContainText("Region");
  await region.locator("button").first().click();
  const reader = page.getByTestId("thread-reader");
  await expect(reader).toContainText("Region");
  await expect(reader.getByTestId("pin-thread")).toContainText("Empty stroma here");
  await reader.getByRole("textbox").click();
  await page.keyboard.type("Agreed, see ");
  await page.keyboard.type("#Reg");
  await page.getByRole("option", { name: /Region 1/ }).click();
  await page.keyboard.press("Enter");
  await expect(
    reader.locator('[data-slot="comment-link"]', { hasText: "#Region 1" }),
  ).toBeVisible();
  await reader.getByRole("button", { name: "All comments" }).click();
  await expect(reader).toHaveCount(0);
});

test("the compare view keeps the comments of the live pane on that pane", async ({ page }) => {
  test.setTimeout(90_000);
  await openCompare(page);
  await page.keyboard.press("c");
  await expect(marks(page).first()).toBeVisible();
  await expect(page.getByTestId("pin-layer")).toHaveCount(1);
  for (const side of ["right", "bottom-left", "bottom-right"]) {
    await expect(comparePane(page, side).locator('[data-slot="comment-pin"]')).toHaveCount(0);
    await expect(comparePane(page, side).locator('[data-slot="comment-anchor"]')).toHaveCount(0);
  }
});
