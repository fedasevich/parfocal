import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const a1 = "00000000-0000-4000-8005-000000000001";
const noCells = "00000000-0000-4000-8005-000000000004";
const rt14 = "00000000-0000-4000-8007-000000000014";
const annotateTask = "00000000-0000-4000-8007-000000000021";
const notification = (index: number) =>
  `00000000-0000-4000-8012-${String(index).padStart(12, "0")}`;

test.use({ viewport: { width: 1440, height: 900 } });

const searchOf = (page: Page) => new URL(page.url()).searchParams;

test("a notification link opens the screen it points at", async ({ page }) => {
  await page.goto(`/go/${notification(6)}`);
  await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]+\/evaluation$/);
  await page.goto(`/go/${notification(1)}`);
  await expect(page).toHaveURL(new RegExp(`/projects/${p07}/slides/${a1}\\?`));
  expect(searchOf(page).get("tab")).toBe("comments");
  expect(searchOf(page).get("object")).toBe("T2");
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
    timeout: 20_000,
  });
});

test("a notification that cannot be opened says so with a way back", async ({ page }) => {
  await page.goto(`/go/${notification(99)}`);
  const gone = page.getByTestId("issue-notification-gone");
  await expect(gone).toContainText("This notification cannot be opened");
  await gone.getByRole("button", { name: "See all notifications" }).click();
  await expect(page).toHaveURL(/\/notifications$/);
});

test("the submitted page with no slide goes to the task instead of loading forever", async ({
  page,
}) => {
  await page.goto(`/tasks/${rt14}/submitted`);
  await expect(page).toHaveURL(new RegExp(`/projects/${p07}/slides/[0-9a-f-]+\\?task=${rt14}`));
  await expect(page.getByText("Loading the review")).toHaveCount(0);
});

test("an annotate task opened as guided lands in annotate with the address corrected", async ({
  page,
}) => {
  await page.goto(`/tasks/${annotateTask}/guided?as=DH`);
  await expect(page).toHaveURL(/mode=annotate/);
  await page.goto(`/projects/${p07}/slides/${a1}?task=${annotateTask}&mode=guided&as=DH`);
  await expect(page).toHaveURL(/mode=annotate/);
  await expect(page.getByTestId("mode-fallback")).toContainText("opened in Annotate");
});

test("cells on a slide with no cell sample falls back to review and says so", async ({ page }) => {
  await page.goto(`/projects/${p07}/slides/${noCells}?task=${rt14}&mode=cells`);
  await expect(page).toHaveURL(/mode=review/);
  await expect(page.getByTestId("mode-fallback")).toContainText("no cell sample");
});

test("an old project tab name is corrected in the address", async ({ page }) => {
  await page.goto(`/projects/${p07}?tab=results`);
  await expect(page).toHaveURL(/tab=slides/);
  await page.goto(`/projects/${p07}?tab=people`);
  await expect(page).toHaveURL(/tab=settings/);
});

test("the PDF preview closes with Escape", async ({ page }) => {
  await page.goto(`/tasks/${rt14}/evaluation?view=pdf`);
  const preview = page.getByRole("dialog", { name: "PDF preview" });
  await expect(preview).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(preview).toBeHidden();
});

test("the browser tab names the page and the slide", async ({ page }) => {
  await page.goto("/my-work");
  await expect(page).toHaveTitle("My work · Parfocal");
  await page.goto(`/projects/${p07}/slides/${a1}?task=${rt14}`);
  await expect(page).toHaveTitle(/A1 · Slide · Parfocal$/);
});

test("task timing and the study page sit inside the app menu", async ({ page }) => {
  for (const path of ["/kpi", "/study"]) {
    await page.goto(path);
    await expect(page.getByRole("navigation").first()).toBeVisible();
  }
});
