import { expect, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const rt14 = "00000000-0000-4000-8007-000000000014";
const fullViewer = /\/projects\/[^/]+\/slides\/[^/?]+\?/;

test("project slide rows are links into the viewer", async ({ page }) => {
  await page.goto(`/projects/${p07}`);
  const live = /\/projects\/[^/]+\/slides\/[^/?]+\/live$/;
  const link = page.getByTestId("slide-link").first();
  await expect(link).toHaveAttribute("href", live);
  const open = page.getByTestId("slide-row").first().getByRole("button", { name: "Open" });
  await expect(open).toHaveAttribute("href", live);
  await link.click();
  await expect(page).toHaveURL(live);
});

test("Automatic imports opens its block in the project settings", async ({ page }) => {
  await page.goto(`/projects/${p07}`);
  await page.getByRole("button", { name: "More project actions" }).click();
  await page.getByRole("menuitem", { name: "Automatic imports" }).click();
  await expect(page).toHaveURL(/tab=settings#automatic-imports$/);
  await expect(page.locator("#automatic-imports")).toBeInViewport();
});

test("a project task row opens its slides, evaluation and disagreements", async ({ page }) => {
  await page.goto(`/projects/${p07}?tab=tasks`);
  const links = page.getByTestId("task-row").first().getByTestId("task-viewer-links");
  await expect(links.getByRole("link", { name: "Slides" })).toHaveAttribute("href", /task=/);
  await expect(links.getByRole("link", { name: "Evaluation" })).toHaveAttribute(
    "href",
    /\/evaluation$/,
  );
  await expect(links.getByRole("link", { name: "Disagreements" })).toHaveAttribute(
    "href",
    /\/disagreements$/,
  );
});

test("Team and Assigned by me link each task to its slides", async ({ page }) => {
  await page.goto("/team");
  const team = page.getByRole("region", { name: /^RT-14 · / });
  await expect(team.getByRole("link", { name: "Slides" })).toHaveAttribute(
    "href",
    new RegExp(`task=${rt14}`),
  );
  await page.goto("/my-work?tab=assigned");
  await expect(
    page.getByTestId("task-viewer-links").first().getByRole("link", { name: "Slides" }),
  ).toHaveAttribute("href", fullViewer);
});

test("each disagreement opens its object in the full viewer", async ({ page }) => {
  await page.goto(`/tasks/${rt14}/disagreements?stage=open`);
  const link = page.getByRole("link", { name: "Open T4 in the full viewer" });
  await expect(link).toHaveAttribute("href", new RegExp(`task=${rt14}&object=T4`));
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/slides/[^?]+\\?task=${rt14}&object=T4`));
});

test("the evaluation report opens each listed object in the full viewer", async ({ page }) => {
  await page.goto(`/tasks/${rt14}/evaluation?scene=report`);
  const link = page.getByTestId("report-viewer-link").first();
  await expect(link).toHaveAttribute("href", new RegExp(`task=${rt14}&object=`));
});

test("My work slide names are links a new tab can open", async ({ page }) => {
  await page.goto("/my-work?tab=all");
  const link = page.getByTestId("slide-link").first();
  await expect(link).toHaveAttribute("href", /\/(slides|tasks)\//);
  await link.click();
  await expect(page).toHaveURL(/tab=all/);
});
