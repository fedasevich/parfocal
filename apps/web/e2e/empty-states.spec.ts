import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const p11 = "00000000-0000-4000-8003-000000000011";

async function openNewProject(page: Page) {
  await page.goto("/projects/new");
  const drawer = page.getByRole("dialog", { name: "New project" });
  await drawer.getByRole("textbox").fill("Empty state study");
  await drawer.getByRole("button", { name: "Create and upload" }).click();
  await expect(page.getByText("Into Empty state study")).toBeVisible();
  await page.getByRole("link", { name: "Empty state study" }).click();
  await expect(page.getByRole("heading", { name: "Empty state study" })).toBeVisible();
}

test("a new project's Slides tab says it has no slides and offers a working upload", async ({
  page,
}) => {
  await openNewProject(page);
  const empty = page.getByTestId("slides-empty");
  await expect(empty).toContainText("No slides in this project yet");
  await expect(page.getByTestId("slides-drop-area")).toContainText(
    "Drop slides, results or a whole folder here",
  );
  await expect(page.getByTestId("slide-row")).toHaveCount(0);
  await page.getByTestId("slides-file-input").setInputFiles({
    name: "tumor_900.svs",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("slide"),
  });
  await expect(page).toHaveURL(/\/upload\?/);
  await expect(page.getByText("tumor_900.svs").first()).toBeVisible();
});

test("a new project's empty Slides tab links to a remote source", async ({ page }) => {
  await openNewProject(page);
  await page
    .getByTestId("slides-empty")
    .getByRole("button", { name: "Link a remote source" })
    .click();
  await expect(page).toHaveURL(/source=link/);
  await expect(page.getByRole("radio", { name: "From a link or storage" })).toBeChecked();
});

test("a new project's Review tasks tab offers the first task", async ({ page }) => {
  await openNewProject(page);
  await page.getByRole("tab", { name: /^Review tasks/ }).click();
  const empty = page.getByTestId("tasks-empty");
  await expect(empty).toContainText("No review tasks in this project yet");
  await expect(page.getByTestId("task-row")).toHaveCount(0);
  await empty.getByRole("button", { name: "New review task" }).click();
  await expect(page).toHaveURL(/\/tasks\/new/);
});

test("a search that matches no slide says so and clears", async ({ page }) => {
  await page.goto(`/projects/${p07}`);
  await expect(page.getByTestId("slide-row").first()).toBeVisible();
  await expect(page.getByTestId("slides-empty")).toHaveCount(0);
  await page.getByLabel("Filter by slide, file or case").fill("zzz-no-such-slide");
  const none = page.getByTestId("slides-no-match");
  await expect(none).toContainText('No slide matches "zzz-no-such-slide"');
  await none.getByRole("button", { name: "Clear filters" }).click();
  await expect(none).toHaveCount(0);
  await expect(page.getByTestId("slide-row").first()).toBeVisible();
});

test("the Needs review filter says no slides need review when none do", async ({ page }) => {
  await page.goto(`/projects/${p11}`);
  await expect(page.getByTestId("slide-row").first()).toBeVisible();
  await page.getByRole("button", { name: /^Needs review/ }).click();
  const none = page.getByTestId("slides-no-match");
  await expect(none).toContainText("No slides need review");
  await none.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.getByTestId("slide-row").first()).toBeVisible();
});

test("two filters with no match share one message", async ({ page }) => {
  await page.goto(`/projects/${p07}`);
  await expect(page.getByTestId("slide-row").first()).toBeVisible();
  await page.getByLabel("Filter by slide, file or case").fill("zzz-no-such-slide");
  await page.getByRole("button", { name: /^No results/ }).click();
  await expect(page.getByTestId("slides-no-match")).toContainText("No slides match these filters");
});

test("My work lists say when no slide matches a search", async ({ page }) => {
  await page.goto("/my-work?tab=all");
  await expect(page.getByTestId("all-slides-empty")).toHaveCount(0);
  await page.getByRole("textbox", { name: "Find a slide, case or ID" }).fill("zzz-no-such-slide");
  const none = page.getByTestId("all-slides-no-match");
  await expect(none).toContainText("No slide matches these filters");
  await none.getByRole("button", { name: "Clear filters" }).click();
  await expect(none).toHaveCount(0);
});
