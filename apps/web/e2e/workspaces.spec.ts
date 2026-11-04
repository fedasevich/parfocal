import { expect, type Page, test } from "@playwright/test";

const p07 = "00000000-0000-4000-8003-000000000007";
const rt14 = "00000000-0000-4000-8007-000000000014";
const annotateTask = "00000000-0000-4000-8007-000000000021";

async function openSlide(page: Page, search = "") {
  await page.goto(`/projects/${p07}?tab=slides`);
  await page.getByTestId("slide-row").filter({ hasText: "tumor_044" }).click();
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
    timeout: 15_000,
  });
  if (search === "") return;
  const url = new URL(page.url());
  await page.goto(`${url.pathname}${search}`);
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
    timeout: 15_000,
  });
}

const stage = (page: Page) => page.getByTestId("slide-stage");
const cameraOf = (page: Page) => page.getByTestId("slide-host").getAttribute("data-camera");
async function settledCamera(page: Page) {
  let last = "";
  await expect
    .poll(async () => {
      const now = (await cameraOf(page)) ?? "";
      const steady = now !== "" && now === last;
      last = now;
      return steady;
    })
    .toBe(true);
  return last;
}
const switchTo = (page: Page, name: "Review" | "Annotate") =>
  page.getByTestId("workspace-switch").getByRole("radio", { name }).click();

async function dragAcross(page: Page) {
  const box = (await stage(page).boundingBox()) ?? { x: 0, y: 0, width: 800, height: 600 };
  await page.mouse.move(box.x + 300, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(box.x + 420, box.y + 360, { steps: 6 });
}

test("a slide with no task opens in Annotate with the full rail and a marquee on drag", async ({
  page,
}) => {
  await openSlide(page);
  await expect(stage(page)).toHaveAttribute("data-workspace", "annotate");
  await expect(stage(page)).toHaveAttribute("data-drag", "marquee");
  await expect(stage(page)).toHaveAttribute("data-tool", "select");
  await expect(page.locator("button[data-tool]")).toHaveCount(14);
});

test("an annotate task opens in Annotate", async ({ page }) => {
  await openSlide(page, `?task=${annotateTask}`);
  await expect(page.getByTestId("case-header")).toContainText("RT-13");
  await expect(stage(page)).toHaveAttribute("data-workspace", "annotate");
  await expect(
    page.getByTestId("workspace-switch").getByRole("radio", { name: "Annotate" }),
  ).toBeChecked();
});

test("a review task opens in Review with the short rail and a pan on drag", async ({ page }) => {
  await openSlide(page, `?task=${rt14}`);
  await expect(stage(page)).toHaveAttribute("data-workspace", "review");
  await expect(stage(page)).toHaveAttribute("data-drag", "pan");
  await expect(stage(page)).toHaveAttribute("data-tool", "hand");
  await expect(page.locator("button[data-tool]")).toHaveCount(5);
  await expect(page.locator('button[data-tool="poly"]')).toHaveCount(0);
});

test("switching workspaces changes the rail and the drag but leaves the camera and the canvas alone", async ({
  page,
}) => {
  await openSlide(page);
  await page.getByTestId("magnification-bar").hover();
  await page.getByRole("button", { name: "40×" }).click();
  await page.mouse.move(2, 2);
  const before = await settledCamera(page);
  const canvas = await stage(page).locator("canvas").elementHandle();

  await switchTo(page, "Review");
  await expect(stage(page)).toHaveAttribute("data-workspace", "review");
  await expect(page.locator("button[data-tool]")).toHaveCount(5);
  await expect(stage(page)).toHaveAttribute("data-tool", "hand");
  await expect(page).toHaveURL(/workspace=review/);
  expect(await cameraOf(page)).toBe(before);
  expect(await canvas?.evaluate((node) => node.isConnected)).toBe(true);
  await expect(stage(page).locator("canvas")).toHaveCount(1);

  await switchTo(page, "Annotate");
  await expect(stage(page)).toHaveAttribute("data-workspace", "annotate");
  await expect(page.locator("button[data-tool]")).toHaveCount(14);
  await expect(stage(page)).toHaveAttribute("data-tool", "select");
  expect(await cameraOf(page)).toBe(before);
  expect(await canvas?.evaluate((node) => node.isConnected)).toBe(true);
});

test("a drag pans in Review and draws a marquee without moving the camera in Annotate", async ({
  page,
}) => {
  await openSlide(page);
  await page.getByTestId("magnification-bar").hover();
  await page.getByRole("button", { name: "40×" }).click();
  await page.mouse.move(2, 2);
  const start = await settledCamera(page);

  await dragAcross(page);
  await expect(page.getByTestId("select-marquee")).toHaveCount(1);
  await page.mouse.up();
  expect(await cameraOf(page)).toBe(start);

  await switchTo(page, "Review");
  await dragAcross(page);
  await expect(page.getByTestId("select-marquee")).toHaveCount(0);
  await page.mouse.up();
  await expect.poll(() => cameraOf(page)).not.toBe(start);
});

test("the Review rail ignores the drawing keys and the marker panel stays out of Review", async ({
  page,
}) => {
  await openSlide(page, "?workspace=review");
  await page.keyboard.press("p");
  await expect(stage(page)).toHaveAttribute("data-tool", "hand");
  await page.keyboard.press("l");
  await expect(stage(page)).toHaveAttribute("data-tool", "ruler");
  await page.keyboard.press("Escape");
  await expect(stage(page)).toHaveAttribute("data-tool", "hand");
  await expect(page.getByTestId("count-panel")).toHaveCount(0);
});
