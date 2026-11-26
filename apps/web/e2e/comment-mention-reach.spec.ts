import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const rt14 = "00000000-0000-4000-8007-000000000014";
const cellsSlide = "00000000-0000-4000-8005-000000000008";

test.use({ viewport: { width: 1440, height: 900 } });
test.describe.configure({ timeout: 120_000 });

const stage = (page: Page) => page.getByTestId("slide-stage");
const composer = (page: Page) => page.getByTestId("pin-composer");
const cards = (page: Page) => page.locator('[data-slot="thread-card"]');
const foot = (page: Page) => page.getByTestId("object-foot");

async function openCell(page: Page) {
  await page.goto(`/projects/${p07}/slides/${cellsSlide}?task=${rt14}&object=C3`);
  await expect(stage(page)).toHaveAttribute("data-state", "ready", { timeout: 60_000 });
  await expect(foot(page)).toHaveAttribute("data-object", "C3", { timeout: 15_000 });
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
}

async function drawRegion(page: Page, from: [number, number], to: [number, number], text: string) {
  const box = await stage(page).boundingBox();
  if (box === null) throw new Error("the stage is not on screen");
  await page.mouse.move(box.x + from[0], box.y + from[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + to[0], box.y + to[1], { steps: 6 });
  await page.mouse.up();
  await expect(composer(page)).toHaveAttribute("data-target", "region");
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
  await expect(composer(page)).toHaveCount(0);
}

const camera = async (page: Page) =>
  ((await page.getByTestId("slide-host").getAttribute("data-camera")) ?? "").split(",").map(Number);

async function settledCamera(page: Page) {
  let before: number[] = [];
  await expect
    .poll(async () => {
      const now = await camera(page);
      const still = now.length > 0 && now.every((value, index) => value === before[index]);
      before = now;
      return still;
    })
    .toBe(true);
  return before;
}

async function openThread(page: Page, title: string) {
  await page.getByRole("tab", { name: /Comments/ }).click();
  await cards(page).filter({ hasText: title }).locator("button").first().click();
  const thread = page.getByTestId("pin-thread");
  await expect(thread).toContainText(title);
  return thread;
}

test("a #Region name reaches the same region for a reader who cannot see every region", async ({
  page,
}) => {
  await openCell(page);
  await page.keyboard.press("c");
  await expect(composer(page)).toHaveAttribute("data-target", "object");
  await page.keyboard.press("Escape");
  await drawRegion(page, [80, 80], [180, 160], "First region");
  await drawRegion(page, [520, 380], [640, 470], "Second region");
  await drawRegion(page, [80, 420], [180, 500], "Third region");

  const thread = await openThread(page, "Third region");
  await thread.getByRole("textbox").click();
  await page.keyboard.type("Same stroma as ");
  await page.keyboard.type("#Reg");
  await page.getByRole("option", { name: /Region 2/ }).click();
  const posted = page.waitForRequest(
    (request) => request.method() === "POST" && (request.postData() ?? "").includes("Same stroma"),
  );
  await page.keyboard.press("Enter");
  expect((await posted).postData() ?? "").toMatch(/#\[#Region 2\|area:\d+,\d+,\d+,\d+\]/);
  const link = thread.locator('[data-slot="comment-link"]', { hasText: "#Region 2" });
  await link.click();
  const researcher = await settledCamera(page);

  await page.evaluate(() => {
    const key = "parfocal.fake.posted-threads";
    const kept = JSON.parse(sessionStorage.getItem(key) ?? "{}") as {
      threads: { title: string }[];
      comments: unknown[];
    };
    kept.threads = kept.threads.filter((item) => item.title !== "First region");
    sessionStorage.setItem(key, JSON.stringify(kept));
  });
  await openCell(page);
  const blind = await openThread(page, "Third region");
  await blind.getByRole("textbox").click();
  await page.keyboard.type("#Reg");
  await expect(page.getByRole("option", { name: /Region 2/ })).toHaveCount(1);
  await expect(page.getByRole("option", { name: /Region 3/ })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await blind.locator('[data-slot="comment-link"]', { hasText: "#Region 2" }).click();
  const reader = await settledCamera(page);
  expect(reader.length).toBe(researcher.length);
  reader.forEach((value, index) => {
    expect(Math.abs(value - (researcher[index] ?? Number.NaN))).toBeLessThan(0.5);
  });
});

test("a notification opens its object from the bell", async ({ page }) => {
  await page.goto(`/projects/${p07}?as=DH`);
  await page.getByRole("button", { name: /^Notifications/ }).click();
  const panel = page.getByRole("dialog", { name: "Notifications" });
  const row = panel.getByTestId("notification").filter({ hasText: "mentioned you in a note" });
  await row.getByTestId("notification-object").locator('[data-slot="comment-link"]').click();
  await expect(page).toHaveURL(/[?&]object=T5/);
  await expect(stage(page)).toHaveAttribute("data-state", "ready", { timeout: 60_000 });
  const notes = page.getByTestId("stage-object-notes");
  await expect(notes).toContainText("Comments on this object", { timeout: 15_000 });
  await expect(notes).toContainText("T5");

  await page.goto(`/projects/${p07}?as=DH`);
  await page.getByRole("button", { name: /^Notifications/ }).click();
  await row.locator('[data-slot="comment-link"]', { hasText: "T4" }).first().click();
  await expect(page).toHaveURL(/[?&]object=T4/);
  await expect(notes).toContainText("T4", { timeout: 15_000 });
  await expect(notes).not.toContainText("T5");
});
