import { expect, test } from "./a11y.ts";

const rt14 = "00000000-0000-4000-8007-000000000014";
const a1 = "00000000-0000-4000-8005-000000000001";
const p07 = "00000000-0000-4000-8003-000000000007";

test("the greeting names the date, the tasks in progress, the mentions and the next due task", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Good afternoon, Lenka" })).toBeVisible();
  await expect(
    page.getByText("Thursday 15 October · 1 task in progress · 2 mentions · Round 2 due Friday"),
  ).toBeVisible();
});

test("the continue card shows the slide, the task, the position, the progress and the due date", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText("Continue where you left off")).toBeVisible();
  await expect(page.getByText("RT-14", { exact: true })).toBeVisible();
  await expect(page.getByText("Round 2 · CAMELYON v1.0").first()).toBeVisible();
  await expect(page.getByText("A1 · S26-04812 · Sentinel node AI evaluation")).toBeVisible();
  await expect(page.getByText("Slide 8 of 12")).toBeVisible();
  await expect(page.getByText("48 of 55 objects decided")).toBeVisible();
  await expect(page.getByText("due Fri 23 Oct").first()).toBeVisible();
  await expect(page.getByText("Blind", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue ↵" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open in the full viewer" })).toBeVisible();
});

test("Open in the full viewer lands on the same slide in the same task", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open in the full viewer" }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${p07}/slides/${a1}\\?task=${rt14}`));
});

test("Start something has the five tiles with one line each", async ({ page }) => {
  await page.goto("/");
  const tiles: [string, string][] = [
    ["Upload", "Slides and their AI results"],
    ["Run a model", "2 slides have no results yet"],
    ["New review task", "Hand slides out to reviewers"],
    ["Find an object", "A slide, a case or an ID like T2·C145"],
    ["New project", "Privacy, classes and a template"],
  ];
  for (const [title, line] of tiles) {
    const tile = page.getByRole("button", { name: new RegExp(`^${title}`) }).filter({
      hasText: line,
    });
    await expect(tile).toHaveCount(1);
  }
});

test("each Start something tile goes where its line says", async ({ page }) => {
  const goes: [string, RegExp][] = [
    ["Upload", /\/projects\/[0-9a-f-]+\/upload$/],
    ["Run a model", /\/projects\/[0-9a-f-]+\/run-model$/],
    ["New review task", /\/projects\/[0-9a-f-]+\/tasks\/new$/],
    ["New project", /\/projects\/new$/],
  ];
  for (const [title, url] of goes) {
    await page.goto("/");
    await page
      .getByRole("button", { name: new RegExp(`^${title}`) })
      .filter({
        hasText: /\w{4}/,
      })
      .first()
      .click();
    await expect(page).toHaveURL(url);
  }
  await page.goto("/");
  await page.getByRole("button", { name: /^Find an object/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("the projects are cards with a strip of slides, the counts, the privacy mode and the share reviewed", async ({
  page,
}) => {
  await page.goto("/");
  const cards = page.getByRole("button", { name: /result sets/ });
  await expect(cards.first()).toContainText("Sentinel node AI evaluation");
  await expect(cards.first()).toContainText("P07 · 61 slides · 3 result sets");
  await expect(cards.first()).toContainText("+57");
  await expect(cards.first()).toContainText("De-identified");
  await expect(cards.first()).toContainText("62%");
  await expect(cards.nth(1)).toContainText("Lymph nodes 2026");
  await expect(cards.nth(1)).toContainText("Clinical");
  await expect(cards.nth(1)).toContainText("39%");
  await cards.first().click();
  await expect(page).toHaveURL(new RegExp(`/projects/${p07}(\\?.*)?$`));
});

test("the side column has the week in numbers, coming up and the announcements", async ({
  page,
}) => {
  await page.goto("/");
  const week = page.getByRole("region", { name: "This week in your projects" });
  await expect(week).toContainText("147");
  await expect(week).toContainText("81%");
  await expect(week.getByRole("button", { name: "3" })).toBeVisible();
  await week.getByRole("button", { name: "3" }).click();
  await expect(page).toHaveURL(new RegExp(`/tasks/${rt14}/disagreements`));
  await page.goBack();
  const coming = page.getByRole("region", { name: "Coming up" });
  await expect(coming).toContainText("Round 2 · CAMELYON v1.0");
  await expect(coming).toContainText("7 of 12 done · due Fri 23 Oct");
  const news = page.getByRole("region", { name: "Announcements" });
  await expect(news).toContainText("CellViT is now one of Parfocal's models");
  await expect(news).toContainText("Parfocal");
});

test("the first-week variant leads with the sample project and the checklist", async ({ page }) => {
  await page.goto("/?scene=new");
  await expect(page.getByRole("heading", { name: "Welcome to Parfocal, Lenka" })).toBeVisible();
  await expect(page.getByText("Start here")).toBeVisible();
  await expect(page.getByText("Sample", { exact: true })).toBeVisible();
  await expect(page.getByText("Nothing here counts in a real evaluation")).toBeVisible();
  const checklist = page.getByRole("region", { name: "Getting started" });
  await expect(checklist).toBeVisible();
  await expect(checklist).toContainText(/\d of \d/);
  await expect(page.getByRole("region", { name: "This week in your projects" })).toHaveCount(0);
  await page.getByRole("button", { name: "Hide the checklist" }).click();
  await expect(checklist).toBeHidden();
});

test("Continue lands on the exact slide and object the derived resume names", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Continue ↵" }).click();
  await expect(page).toHaveURL(new RegExp(`/tasks/${rt14}/guided\\?slide=${a1}&object=T5$`));
  await expect(page.getByText("The AI says T5 is tumor, 52% sure.")).toBeVisible({
    timeout: 60_000,
  });
});
