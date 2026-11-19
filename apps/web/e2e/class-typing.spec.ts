import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const p11 = "00000000-0000-4000-8003-000000000011";
const tumor044 = "00000000-0000-4000-8005-000000000005";
const a1 = "00000000-0000-4000-8005-000000000001";
const noClassesSlide = "00000000-0000-4000-8005-000000000012";
const cellsSlide = "00000000-0000-4000-8005-000000000008";
const rt14 = "00000000-0000-4000-8007-000000000014";
const samSet = "00000000-0000-4000-8006-000000000002";

test.use({ viewport: { width: 1440, height: 900 } });
test.describe.configure({ timeout: 90_000 });

async function ready(page: Page) {
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  await expect(stage).toHaveAttribute("data-annotations", "loaded");
  return stage;
}

const corners = [
  [200, 150],
  [420, 170],
  [380, 360],
  [220, 330],
] as const;

async function drawSquare(page: Page, box: { x: number; y: number }) {
  await page.keyboard.press("p");
  for (const [x, y] of corners) await page.mouse.click(box.x + x, box.y + y);
  await page.mouse.click(box.x + corners[0][0] + 2, box.y + corners[0][1] + 1);
}

test("a project without classes says so and links to where classes are added", async ({ page }) => {
  await page.goto(`/projects/${p11}/slides/${noClassesSlide}?as=DH`);
  await ready(page);
  const notice = page.getByTestId("no-classes");
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("This project has no classes");
  await expect(page.getByTestId("no-classes-link")).toHaveAttribute(
    "href",
    new RegExp(`/projects/${p11}\\?.*modal=addcls`),
  );
});

test("a digit re-classes the selected outline, saves it and keeps it after a reload", async ({
  page,
}) => {
  await page.goto(`/projects/${p07}/slides/${tumor044}?as=DH`);
  const stage = await ready(page);
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0 };
  await drawSquare(page, box);
  const shape = page.getByTestId("polygon-shape");
  await expect(shape).toHaveCount(1);
  const first = await shape.getAttribute("data-class");
  await expect(stage).toHaveAttribute("data-save-state", "saved");

  await page.keyboard.press("v");
  await page.mouse.click(box.x + 300, box.y + 250);
  await expect(page.getByTestId("select-layer")).toHaveAttribute("data-selected", "1");
  const strip = page.getByTestId("class-strip");
  await expect(strip).toHaveAccessibleName("Class for the selection");
  await expect(strip.getByTestId("class-swatch")).toHaveCount(4);

  const target = strip.getByTestId("class-swatch").nth(2);
  const wanted = (await target.getAttribute("data-class")) ?? "";
  expect(wanted).not.toBe(first);
  const saved = page.waitForRequest(
    (request) =>
      ["PUT", "PATCH"].includes(request.method()) && (request.postData() ?? "").includes(wanted),
  );
  await page.keyboard.press("3");
  await saved;
  await expect(shape).toHaveAttribute("data-class", wanted);
  await expect(stage).toHaveAttribute("data-save-state", "saved");

  await page.reload();
  await ready(page);
  await expect(shape).toHaveCount(1);
  await expect(shape).toHaveAttribute("data-class", wanted);
});

test("a click picks an imported AI cell, outlines it and shows its ID, type and score", async ({
  page,
}) => {
  await page.goto(`/projects/${p07}/slides/${a1}?as=DH`);
  const stage = await ready(page);
  const cells = page.locator(`[data-testid="result-set-cells"][data-set="${samSet}"]`);
  await expect(cells).toHaveAttribute("data-drawn", "outlines", { timeout: 20_000 });
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
  await expect(page.getByTestId("picked-cell-id")).toHaveText(picked);
  await expect(page.getByTestId("picked-cell-type")).not.toHaveText("");
  await expect(page.getByTestId("picked-cell-score")).toHaveText(/^\d\.\d\d$/);
});

test("K and X carry one name each on the card and on the type bar", async ({ page }) => {
  await page.goto(`/projects/${p07}/slides/${cellsSlide}?task=${rt14}&object=C2`);
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
    timeout: 30_000,
  });
  const bar = page.getByTestId("cell-type-bar");
  await expect(bar.getByRole("button", { name: /Agree/ })).toBeVisible();
  await expect(bar.getByRole("button", { name: /Disagree/ })).toBeVisible();
  await expect(bar.getByRole("button", { name: /Keep|Not a cell/ })).toHaveCount(0);
  const panel = page.getByRole("complementary", { name: "Side panel" });
  await expect(panel.getByRole("button", { name: /Keep|Not a cell/ })).toHaveCount(0);
});
