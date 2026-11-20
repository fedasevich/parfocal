import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const a1 = "00000000-0000-4000-8005-000000000001";
const noCells = "00000000-0000-4000-8005-000000000004";
const rt14 = "00000000-0000-4000-8007-000000000014";
const p03 = "00000000-0000-4000-8003-000000000003";
const sentinelCase = "00000000-0000-4000-8004-000000000006";
const unknownSlide = "00000000-0000-4000-8005-0000000000ff";
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

test("the adjudication notice opens the adjudication screen", async ({ page }) => {
  await page.goto(`/go/${notification(11)}?as=SM`);
  await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]+\/adjudicate$/);
});

test("an unknown slide address is Page not found with no loading screen", async ({ page }) => {
  await page.goto(`/projects/${p07}/slides/${unknownSlide}`);
  await expect(page.getByTestId("issue-not-found")).toBeVisible();
});

test("a slide opened under another project goes to its own project", async ({ page }) => {
  await page.goto(`/projects/${p03}/slides/${a1}?tab=comments`);
  await expect(page).toHaveURL(new RegExp(`/projects/${p07}/slides/${a1}\\?`));
  expect(searchOf(page).get("tab")).toBe("comments");
});

test("unknown mode and tab values leave the address and say nothing wrong", async ({ page }) => {
  await page.goto(`/projects/${p07}/slides/${a1}?mode=banana`);
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
    timeout: 20_000,
  });
  expect(searchOf(page).has("mode")).toBe(false);
  await expect(page.getByTestId("mode-fallback")).toHaveCount(0);
  await page.goto(`/projects/${p07}/slides/${a1}?tab=nonsense`);
  await expect.poll(() => searchOf(page).has("tab")).toBe(false);
  await page.goto(`/projects/${p07}/slides/${a1}?tab=opinion`);
  await expect.poll(() => searchOf(page).get("tab")).not.toBe("opinion");
});

test("natural addresses go to the page they mean", async ({ page }) => {
  await page.goto(`/tasks/${rt14}`);
  await expect(page).toHaveURL(new RegExp(`/projects/${p07}/slides/[0-9a-f-]+\\?task=${rt14}`));
  await page.goto("/projects");
  await expect(page).toHaveURL(/\/$/);
  await page.goto(`/projects/${p03}/cases/${sentinelCase}`);
  await expect(page).toHaveURL(new RegExp(`/projects/${p03}/cases/${sentinelCase}/report`));
});

test("an annotate task has no evaluation and says so without failing calls", async ({ page }) => {
  const failures: string[] = [];
  page.on("response", (response) => {
    if (response.status() === 409) failures.push(response.url());
  });
  await page.goto(`/tasks/${annotateTask}/evaluation`);
  await expect(page.getByTestId("issue-annotate-task-has-none")).toContainText("no evaluation");
  await page.goto(`/tasks/${annotateTask}/disagreements`);
  await expect(page.getByTestId("issue-annotate-task-has-none")).toContainText("no disagreements");
  expect(failures).toEqual([]);
});

test("search keeps its words in the address across a reload", async ({ page }) => {
  await page.goto("/search?q=Showcase");
  const box = page.getByRole("searchbox").or(page.getByRole("textbox")).first();
  await expect(box).toHaveValue("Showcase");
  await box.fill("tumor");
  await expect.poll(() => searchOf(page).get("q")).toBe("tumor");
  await page.reload();
  await expect(box).toHaveValue("tumor");
});

test("opening a report creates nothing, and an unknown case is Page not found", async ({
  page,
}) => {
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.method() !== "GET" && new URL(request.url()).pathname.startsWith("/api/")) {
      writes.push(`${request.method()} ${new URL(request.url()).pathname}`);
    }
  });
  await page.goto(`/projects/${p03}/cases/${sentinelCase}/report`);
  await expect(page.getByTestId("clinical-report")).toBeVisible();
  expect(writes.filter((write) => write.startsWith("POST"))).toEqual([]);
  writes.length = 0;
  await page.goto(`/projects/${p03}/cases/00000000-0000-4000-8004-0000000000ff/report`);
  await expect(page.getByTestId("issue-not-found")).toBeVisible();
  expect(writes).toEqual([]);
});

test("the person asked to co-sign is sent to the co-sign page", async ({ page }) => {
  test.setTimeout(90_000);
  const flow = page.getByTestId("clinical-report");
  await page.goto(`/projects/${p03}/cases/${sentinelCase}/report?as=TB`);
  const next = flow.getByRole("button", { name: "Next" });
  await next.click();
  await flow.getByRole("radio", { name: /Macrometastasis/ }).click();
  await flow.getByRole("radio", { name: "Absent" }).click();
  await next.click();
  await next.click();
  await flow.getByPlaceholder("Type a name").click();
  await page.getByRole("option", { name: /Lenka Malá/ }).click();
  await flow.getByRole("button", { name: "Send for co-sign" }).click();
  await expect(flow.getByText(/Sent to Lenka Malá/)).toBeVisible();
  await page.goto(`/projects/${p03}/cases/${sentinelCase}/report?as=LM`);
  await expect(page).toHaveURL(/\/co-sign/);
  await expect(page.getByTestId("co-sign")).toBeVisible();
});

test("an old project tab name says where it went", async ({ page }) => {
  await page.goto(`/projects/${p07}?tab=results`);
  await expect(page).toHaveURL(/tab=slides/);
  await expect(page.getByText("The Results tab moved to Slides.")).toBeVisible();
  await page.goto(`/projects/${p07}?tab=nonsense`);
  await expect.poll(() => searchOf(page).get("tab")).toBe("slides");
});

test("pages without a tab name of their own now have one", async ({ page }) => {
  const titles: [string, RegExp][] = [
    [`/projects/${p07}`, /Project · Parfocal$/],
    [`/projects/${p03}/cases/${sentinelCase}/report`, /Clinical report · Parfocal$/],
    [`/projects/${p03}/cases/new`, /New case · Parfocal$/],
    [`/projects/${p07}/tasks/new`, /New review task · Parfocal$/],
    [`/projects/${p07}/tasks/new-annotate`, /New annotate task · Parfocal$/],
    ["/setup", /Set up the workspace · Parfocal$/],
  ];
  for (const [path, title] of titles) {
    await page.goto(path);
    await expect(page).toHaveTitle(title);
  }
});
