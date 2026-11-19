import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const annotateTask = "00000000-0000-4000-8007-000000000021";
const withResults = "00000000-0000-4000-8005-000000000005";
const byHand = "00000000-0000-4000-8005-000000000014";
const samSet = "00000000-0000-4000-8006-000000000002";

test.use({ viewport: { width: 1440, height: 900 } });
test.describe.configure({ timeout: 90_000 });

async function openTaskSlide(page: Page, slideId: string, tab = "objects") {
  await page.goto(`/projects/${p07}/slides/${slideId}/live?task=${annotateTask}&tab=${tab}&as=DH`);
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  await expect(stage).toHaveAttribute("data-annotations", "loaded");
  await expect(stage).toHaveAttribute("data-layer", "shared");
  return stage;
}

async function drawRectangle(page: Page, from: [number, number], to: [number, number]) {
  const stage = page.getByTestId("slide-stage");
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0 };
  if ((await stage.getAttribute("data-tool")) !== "rectangle") await page.keyboard.press("r");
  await expect(stage).toHaveAttribute("data-tool", "rectangle");
  await page.mouse.move(box.x + from[0], box.y + from[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + to[0], box.y + to[1], { steps: 5 });
  await page.mouse.up();
}

const rowOf = (page: Page, name: string) =>
  page.getByTestId("layers-panel").locator("li", { hasText: name });

test("an AI cell is picked and re-typed inside an annotate task", async ({ page }) => {
  const stage = await openTaskSlide(page, withResults);
  const cells = page.locator(`[data-testid="result-set-cells"][data-set="${samSet}"]`);
  await expect(cells).toHaveAttribute("data-drawn", "outlines", { timeout: 20_000 });
  await page.keyboard.press("v");
  await expect(stage).toHaveAttribute("data-tool", "select");
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0, width: 800, height: 600 };
  let picked = "";
  for (let y = 120; y < box.height - 120 && picked === ""; y += 14) {
    for (let x = 120; x < box.width - 360 && picked === ""; x += 14) {
      await page.mouse.click(box.x + x, box.y + y);
      await page.waitForTimeout(60);
      picked = (await cells.getAttribute("data-picked")) ?? "";
    }
  }
  expect(picked).toMatch(new RegExp(`^${samSet}:\\d+$`));
  const card = page.getByTestId("picked-cell");
  await expect(card).toHaveAttribute("data-cell", picked);
  await expect(card).not.toContainText("edit this cell in an annotate task");
  const choices = card.getByTestId("picked-cell-class");
  await expect(choices).toHaveCount(3);
  const before = (await page.getByTestId("picked-cell-type").textContent()) ?? "";
  const names = await choices.allTextContents();
  const target = names.findIndex((name) => name.trim() !== before.trim());
  const wanted = names[target]?.trim() ?? "";
  const number = picked.split(":")[1];
  const saved = page.waitForRequest(
    (request) =>
      request.method() === "PUT" && request.url().endsWith(`/shared-layer/ai/C${number}`),
  );
  await choices.nth(target).click();
  const body = (await saved).postDataJSON() as { class_id: string; geometry: { type: string } };
  expect(body.class_id).toBe(await choices.nth(target).getAttribute("data-class"));
  expect(body.geometry.type).toBe("Polygon");
  await expect(card.getByTestId("picked-cell-retype")).toHaveAttribute("data-state", "saved");
  await expect(page.getByTestId("picked-cell-type")).toHaveText(wanted);
});

test("groups made in a shared annotate task are saved on the task and come back", async ({
  page,
}) => {
  const stage = await openTaskSlide(page, byHand, "display");
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0 };
  await drawRectangle(page, [200, 200], [400, 260]);
  await drawRectangle(page, [500, 200], [700, 260]);
  await expect(page.getByTestId("polygon-shape")).toHaveCount(2);
  await expect(stage).toHaveAttribute("data-save-state", "saved");

  await page.keyboard.press("v");
  await page.mouse.click(box.x + 300, box.y + 230);
  await page.keyboard.down("Shift");
  await page.mouse.click(box.x + 600, box.y + 230);
  await page.keyboard.up("Shift");
  await expect(page.getByTestId("select-layer")).toHaveAttribute("data-selected", /^\d+,\d+$/);
  const groupSaved = page.waitForRequest(
    (request) =>
      request.method() === "PUT" &&
      request.url().includes(`/review-tasks/${annotateTask}/slides/${byHand}/shared-layer/groups`),
  );
  await page.keyboard.press("Control+g");
  await groupSaved;
  await expect(rowOf(page, "Group 1")).toContainText("2");

  await page.getByRole("button", { name: "New shapes go to Group 1" }).dblclick();
  await page.getByLabel("Name of Group 1").fill("Margins");
  const renamed = page.waitForRequest(
    (request) =>
      request.method() === "PUT" &&
      request.url().endsWith("/shared-layer/groups") &&
      (request.postData() ?? "").includes("Margins"),
  );
  await page.keyboard.press("Enter");
  await renamed;

  await page.reload();
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-annotations", "loaded", {
    timeout: 30_000,
  });
  await expect(rowOf(page, "Margins")).toContainText("2");
  await expect(rowOf(page, "Ungrouped")).toHaveCount(0);
});
