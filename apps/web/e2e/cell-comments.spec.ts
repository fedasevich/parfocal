import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const a1 = "00000000-0000-4000-8005-000000000001";
const withResults = "00000000-0000-4000-8005-000000000005";
const annotateTask = "00000000-0000-4000-8007-000000000021";
const samSet = "00000000-0000-4000-8006-000000000002";

test.use({ viewport: { width: 1440, height: 900 } });
test.describe.configure({ timeout: 90_000 });

const stage = (page: Page) => page.getByTestId("slide-stage");
const composer = (page: Page) => page.getByTestId("pin-composer");
const marks = (page: Page) => page.locator('[data-slot="comment-anchor"]');
const cards = (page: Page) => page.locator('[data-slot="thread-card"]');

async function pickedNumber(page: Page) {
  const cells = page.locator(`[data-testid="result-set-cells"][data-set="${samSet}"]`);
  await expect(cells).toHaveAttribute("data-picked", new RegExp(`^${samSet}:\\d+$`), {
    timeout: 20_000,
  });
  return ((await cells.getAttribute("data-picked")) ?? "").split(":")[1] ?? "";
}

async function sendComment(page: Page, text: string) {
  await expect(composer(page).getByRole("textbox")).toBeFocused();
  const posted = page.waitForRequest(
    (request) => request.method() === "POST" && /\/threads$/.test(new URL(request.url()).pathname),
  );
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
  const body = (await posted).postDataJSON() as {
    anchor: { kind: string; object_id?: string; result_set_id?: string };
  };
  await expect(composer(page)).toHaveCount(0);
  return body.anchor;
}

test("a cell picked in the plain viewer takes a comment anchored to its ID", async ({ page }) => {
  await page.goto(`/projects/${p07}/slides/${a1}?object=C5&as=DH`);
  await expect(stage(page)).toHaveAttribute("data-state", "ready", { timeout: 60_000 });
  const number = await pickedNumber(page);
  expect(number).toBe("5");
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await page.keyboard.press("c");
  await expect(composer(page)).toHaveAttribute("data-target", "object");
  await expect(page.getByTestId("comment-target")).toContainText("Comment on C5");
  const anchor = await sendComment(page, "Is this a lymphocyte?");
  expect(anchor).toMatchObject({ kind: "object", object_id: "C5", result_set_id: samSet });
  await expect(marks(page)).toHaveCount(1);
  await expect(marks(page).first()).toHaveAttribute("data-anchor", "C5");

  await page.reload();
  await expect(stage(page)).toHaveAttribute("data-state", "ready", { timeout: 60_000 });
  await expect(marks(page)).toHaveCount(1, { timeout: 20_000 });
  await page.getByRole("tab", { name: /Comments/ }).click();
  const card = cards(page).filter({ hasText: "Is this a lymphocyte?" });
  await expect(card).toContainText("C5");
  await expect(card).toContainText("Cell");
});

test("the comment tool on an annotate task AI cell anchors to the cell", async ({ page }) => {
  await page.goto(`/projects/${p07}/slides/${withResults}?task=${annotateTask}&tab=objects&as=DH`);
  await expect(stage(page)).toHaveAttribute("data-state", "ready", { timeout: 60_000 });
  const cells = page.locator(`[data-testid="result-set-cells"][data-set="${samSet}"]`);
  await expect(cells).toHaveAttribute("data-drawn", "outlines", { timeout: 20_000 });
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await page.keyboard.press("v");
  const box = (await stage(page).boundingBox()) ?? { x: 0, y: 0, width: 800, height: 600 };
  let picked = "";
  for (let y = 120; y < box.height - 120 && picked === ""; y += 14) {
    for (let x = 120; x < box.width - 360 && picked === ""; x += 14) {
      await page.mouse.click(box.x + x, box.y + y);
      await page.waitForTimeout(60);
      picked = (await cells.getAttribute("data-picked")) ?? "";
    }
  }
  const number = picked.split(":")[1] ?? "";
  expect(number).toMatch(/^\d+$/);
  await page.keyboard.press("c");
  await expect(composer(page)).toHaveAttribute("data-target", "object");
  await expect(page.getByTestId("comment-target")).toContainText(`Comment on C${number}`);
  const anchor = await sendComment(page, "Retype this one?");
  expect(anchor).toMatchObject({ kind: "object", object_id: `C${number}` });
  expect(anchor.result_set_id).toBeUndefined();
  await expect(marks(page)).toHaveCount(1);
  await page.getByRole("tab", { name: /Comments/ }).click();
  const card = cards(page).filter({ hasText: "Retype this one?" });
  await expect(card).toContainText(`C${number}`);
});
