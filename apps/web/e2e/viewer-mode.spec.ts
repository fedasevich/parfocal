import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const p03 = "00000000-0000-4000-8003-000000000003";
const a1 = "00000000-0000-4000-8005-000000000001";
const tumor044 = "00000000-0000-4000-8005-000000000005";
const rt14 = "00000000-0000-4000-8007-000000000014";
const annotateTask = "00000000-0000-4000-8007-000000000021";

test.use({ viewport: { width: 1440, height: 900 } });

async function ready(page: Page) {
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 20_000 });
  return stage;
}

async function panelOf(page: Page) {
  const inspector = page.getByTestId("stage-inspector");
  await expect(inspector).toBeVisible();
  const tabs = await inspector
    .getByRole("tab")
    .evaluateAll((all) => all.map((tab) => (tab.textContent ?? "").replace(/\d+$/, "").trim()));
  return { tabs, first: await inspector.getAttribute("data-tab") };
}

async function firstSlideOf(page: Page, projectId: string, persona: string) {
  await page.goto(`/projects/${projectId}?as=${persona}`);
  const href = (await page.getByTestId("slide-link").first().getAttribute("href")) ?? "";
  return href.split("/slides/")[1]?.split("?")[0] ?? "";
}

const rows = [
  {
    name: "no task, project owner",
    url: `/projects/${p07}/slides/${a1}`,
    workspace: "annotate",
    tabs: ["Objects", "Display", "Comments"],
    first: "display",
    switch: ["Full viewer", "Annotate"],
  },
  {
    name: "review task, assigned reviewer",
    url: `/projects/${p07}/slides/${a1}?task=${rt14}`,
    workspace: "review",
    tabs: ["Objects", "Display", "Comments", "Opinion"],
    first: "objects",
    switch: ["Guided", "Full viewer"],
  },
  {
    name: "review task, guided",
    url: `/tasks/${rt14}/guided?slide=${a1}`,
    workspace: "review",
    tabs: ["Review", "Comments", "Display"],
    first: "objects",
    switch: ["Guided", "Full viewer"],
  },
  {
    name: "review task, cell typing",
    url: `/tasks/${rt14}/cells?slide=${a1}`,
    workspace: "review",
    tabs: ["Objects", "Display", "Comments", "Opinion"],
    first: "objects",
    switch: ["Guided", "Full viewer"],
  },
  {
    name: "review task, not assigned",
    url: `/projects/${p07}/slides/${a1}?task=${rt14}&tab=opinion&as=DH`,
    workspace: "review",
    tabs: ["Objects", "Display", "Comments"],
    first: "objects",
    switch: [],
  },
  {
    name: "annotate task, assigned expert",
    url: `/projects/${p07}/slides/${tumor044}?task=${annotateTask}&workspace=review`,
    workspace: "annotate",
    tabs: ["Objects", "Display", "Comments"],
    first: "objects",
    switch: [],
  },
] as const;

for (const row of rows) {
  test(`the tabs and the first tab follow the task: ${row.name}`, async ({ page }) => {
    await page.goto(row.url);
    const stage = await ready(page);
    await expect(stage).toHaveAttribute("data-workspace", row.workspace);
    await expect
      .poll(async () => (await panelOf(page)).tabs, { timeout: 15_000 })
      .toEqual([...row.tabs]);
    expect((await panelOf(page)).first).toBe(row.first);
    const choices = page.getByTestId("workspace-switch").getByRole("radio");
    if (row.switch.length === 0) await expect(page.getByTestId("workspace-switch")).toHaveCount(0);
    else await expect(choices).toHaveText([...row.switch]);
  });
}

test("a project viewer opens a slide look only and is never offered Annotate", async ({ page }) => {
  const slide = await firstSlideOf(page, p03, "JR");
  expect(slide).not.toBe("");
  await page.goto(`/projects/${p03}/slides/${slide}?workspace=annotate&as=JR`);
  const stage = await ready(page);
  await expect(stage).toHaveAttribute("data-workspace", "review");
  await expect(stage).toHaveAttribute("data-access", "read-only", { timeout: 15_000 });
  await expect(page.getByTestId("workspace-switch")).toHaveCount(0);
  await expect(page.getByRole("radio", { name: "Annotate" })).toHaveCount(0);
  const tools = page.locator("button[data-tool]");
  expect(await tools.evaluateAll((all) => all.map((tool) => tool.dataset["tool"]))).toEqual([
    "select",
    "hand",
    "ruler",
  ]);
  const panel = await panelOf(page);
  expect(panel.tabs).not.toContain("Opinion");
  expect(panel.tabs).toContain(panel.first === "display" ? "Display" : "Objects");
});

async function landsInAnnotate(page: Page, slideId: string) {
  await expect(page).toHaveURL(new RegExp(`/projects/${p07}/slides/${slideId}(\\?|$)`));
  expect(page.url()).not.toContain("workspace=");
  expect(page.url()).not.toContain("/live");
  const stage = await ready(page);
  await expect(stage).toHaveAttribute("data-workspace", "annotate");
  expect((await panelOf(page)).first).toBe("display");
}

const a3 = "00000000-0000-4000-8005-000000000003";

test("one slide lands in the same mode from the project row, search and My work", async ({
  page,
}) => {
  await page.goto(`/projects/${p07}`);
  await page.locator(`[data-testid=slide-link][href$="${a3}"]`).click();
  await landsInAnnotate(page, a3);

  await page.goto("/search");
  await page.getByRole("textbox", { name: "Search everything" }).fill("S26-04812 A3");
  await page
    .getByRole("button", { name: /^S26-04812 A3/ })
    .first()
    .click();
  await landsInAnnotate(page, a3);

  await page.goto("/my-work?tab=all");
  const mine = page.locator(`[data-testid=slide-link][href$="${a3}"]`);
  await expect(mine).toHaveAttribute("href", `/projects/${p07}/slides/${a3}`);
  await mine.dblclick();
  await landsInAnnotate(page, a3);
});

test("the report and the task Slides link open the task slide in the same Review mode", async ({
  page,
}) => {
  await page.goto(`/tasks/${rt14}/evaluation?scene=report`);
  const report = page.getByTestId("report-viewer-link").first();
  await expect(report).not.toHaveAttribute("href", /workspace=/);
  await report.click();
  await expect(page).toHaveURL(new RegExp(`task=${rt14}`));
  const fromReport = await ready(page);
  await expect(fromReport).toHaveAttribute("data-workspace", "review");
  expect((await panelOf(page)).first).toBe("objects");

  await page.goto(`/projects/${p07}?tab=tasks`);
  const slides = page
    .getByTestId("task-row")
    .first()
    .getByTestId("task-viewer-links")
    .getByRole("link", { name: "Slides" });
  await expect(slides).not.toHaveAttribute("href", /workspace=/);
});
