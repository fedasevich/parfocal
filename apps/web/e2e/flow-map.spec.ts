import { expect, test } from "@playwright/test";

const chapterTitles = [
  "Upload",
  "Run a model",
  "New review task",
  "Watching progress",
  "Review",
  "Disagreements",
  "Adjudication",
  "Sign-off and report",
  "Clinical report",
];

test("the flow map shows four lanes, every box and the hand-off labels", async ({ page }) => {
  await page.goto("/flow-map");
  const map = page.getByTestId("flow-map");
  await expect(map.getByRole("heading", { name: "How a review works" })).toBeVisible();
  for (const lane of ["Researcher", "Reviewer", "Adjudicator", "Clinical project only"]) {
    await expect(map.getByRole("region", { name: lane })).toBeVisible();
  }
  await expect(map.locator("[data-box]")).toHaveCount(21);
  await expect(map.locator('a[data-box="upload"]')).toHaveAttribute(
    "href",
    /\/upload\?scene=files&as=DH$/,
  );
  for (const label of [
    "Task sent",
    "Submitted",
    "Decided",
    "Sent to the adjudicator",
    "Signed off",
  ]) {
    await expect(map.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(map.getByRole("region", { name: "Researcher" })).toContainText("Daniel Hruška");
});

test("a box opens its screen in its scene as the lane's persona, and Back to the map returns", async ({
  page,
}) => {
  const cases = [
    { box: "team", heading: "Team", url: /\/team\?scene=open&as=DH$/, persona: "Daniel Hruška" },
    {
      box: "worklist",
      heading: "My work",
      url: /\/my-work\?tab=review&as=LM$/,
      persona: "Lenka Malá",
    },
    {
      box: "adjudicate",
      heading: "The AI says T4 is tumor, 58% sure.",
      url: /\/tasks\/[0-9a-f-]+\/disagreements\?scene=adjudicate&as=AK$/,
      persona: "Anna Kopecká",
    },
    {
      box: "crcosign",
      heading: "Clinical report",
      url: /\/slides\/[0-9a-f-]+\/report\?scene=cosign&as=TB$/,
      persona: "Tomáš Beneš",
    },
  ];
  for (const { box, heading, url, persona } of cases) {
    await page.goto("/flow-map");
    await page.locator(`a[data-box="${box}"]`).click();
    await expect(page).toHaveURL(url);
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    const bar = page.getByTestId("prototype-bar");
    await expect(bar).toContainText("Opened from How a review works");
    await expect(bar.getByTestId("persona-chip")).toContainText(persona);
    if (persona !== "Lenka Malá") {
      await expect(page.getByTestId("fake-data-badge")).toContainText(`viewing as ${persona}`);
    }
    await page.reload();
    await expect(page.getByTestId("prototype-bar")).toBeVisible();
    await page.getByRole("link", { name: "Back to the map" }).click();
    await expect(page).toHaveURL(/\/flow-map$/);
    await expect(page.getByTestId("prototype-bar")).toHaveCount(0);
  }
});

test("every box opens a route of the app, never the not found page", async ({ page }) => {
  await page.goto("/flow-map");
  await expect(page.locator("a[data-box]")).toHaveCount(21);
  const ids = await page
    .locator("[data-box]")
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-box") ?? ""));
  expect(ids).toHaveLength(21);
  for (const id of ids) {
    await page.goto("/flow-map");
    await page.locator(`a[data-box="${id}"]`).click();
    await expect(page.getByTestId("prototype-bar")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Page not found" })).toHaveCount(0);
  }
});

test("each walkthrough chapter opens with its steps, and a step steps on to the next", async ({
  page,
}) => {
  await page.goto("/flow-map/walkthrough");
  await expect(page.getByRole("table", { name: "Chapters" }).getByRole("row")).toHaveCount(10);
  for (const [index, title] of chapterTitles.entries()) {
    await page.goto(`/flow-map/walkthrough/${index + 1}`);
    await expect(page.getByRole("heading", { name: `${index + 1} · ${title}` })).toBeVisible();
    await expect(
      page.getByRole("list", { name: "Steps" }).getByRole("listitem").first(),
    ).toBeVisible();
  }
  await page.goto("/flow-map/walkthrough/9");
  await page.getByRole("link", { name: "Open step 9", exact: true }).click();
  await expect(page.getByTestId("walk-position")).toHaveText("9 · Clinical report, step 9 of 14");
  await page.getByRole("link", { name: "Next step" }).click();
  await expect(page.getByTestId("walk-position")).toHaveText("9 · Clinical report, step 10 of 14");
  await expect(page.getByTestId("persona-chip")).toContainText("Tomáš Beneš");
  await expect(page).toHaveURL(/\/report\?scene=cosign&as=TB$/);
});

test("Play all starts the walkthrough at the first step of Upload", async ({ page }) => {
  await page.goto("/flow-map");
  await page.getByRole("link", { name: "Play all, from upload to the signed report" }).click();
  await expect(page.getByTestId("walk-position")).toHaveText("1 · Upload, step 1 of 7");
  await page.getByRole("link", { name: "Next step" }).click();
  await expect(page).toHaveURL(/\/upload\?scene=empty&as=DH$/);
});

test("an unknown chapter is not found", async ({ page }) => {
  await page.goto("/flow-map/walkthrough/10");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
});
