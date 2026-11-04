import { expect, type Page, test } from "@playwright/test";

const rt14 = "00000000-0000-4000-8007-000000000014";
const a1 = "00000000-0000-4000-8005-000000000001";
const a2 = "00000000-0000-4000-8005-000000000002";
const tumor052 = "00000000-0000-4000-8005-000000000014";

const review = (page: Page) => page.getByRole("tabpanel");

const guided: { scene: string; shows: string | RegExp; slide?: string }[] = [
  { scene: "first", shows: "The AI found this. It is outlined in white." },
  { scene: "region", shows: "The AI says T5 is tumor, 52% sure." },
  { scene: "disagree", shows: "You disagree with the AI on T5" },
  { scene: "note", shows: "Note on decision: Disagree" },
  { scene: "comments", shows: "Does the boundary run past the capsule fold here?" },
  { scene: "mention", shows: "Researcher · AI evaluation" },
  { scene: "grid", shows: "The AI says this is a tumor cell, only 54% sure." },
  { scene: "cellrest", shows: "Agree with 6 open cells?" },
  { scene: "cellwhole", shows: "50 sampled cells" },
  { scene: "certainty", shows: "How sure are you that T5 is tumor?" },
  { scene: "yesno", shows: "Is this tumor?" },
  { scene: "blind", shows: "What is T5?" },
  { scene: "display", shows: "Only for you, on RT-14." },
  { scene: "locked", shows: "Locked by RT-14: confidence hidden this round" },
  { scene: "preset", shows: "Dots, no IDs" },
  { scene: "done", shows: "Slide 8 is done" },
  { scene: "skipped", shows: "6 cells in the sample are still open" },
  { scene: "required", shows: "Question 1 is not answered." },
  { scene: "submitfail", shows: "The review could not be submitted." },
  { scene: "connlost", shows: "Not saved yet. It saves when the connection is back." },
  { scene: "slidefail", shows: "A1 could not be read at 20x and 40x." },
  { scene: "noresults", shows: "Nothing to decide here yet.", slide: tumor052 },
  { scene: "withdrawn", shows: "RT-14 was withdrawn" },
  { scene: "signedoff", shows: "Signed off. Ask the researcher to amend." },
];

for (const { scene, shows, slide } of guided) {
  test(`the ${scene} guided review scene opens on fake data`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`/tasks/${rt14}/guided?slide=${slide ?? a1}&scene=${scene}`);
    await expect(page.getByText("Round 2 · CAMELYON v1.0")).toBeVisible();
    await expect(page.getByText(shows).first()).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test("the mention scene offers only people who may see the comment", async ({ page }) => {
  await page.goto(`/tasks/${rt14}/guided?slide=${a1}&scene=mention`);
  const picker = page.getByRole("listbox", { name: "Mention someone" });
  await expect(picker).toContainText("Daniel Hruška");
  await page.getByRole("textbox", { name: "Comment on T2" }).press("Enter");
  await expect(page.getByRole("textbox", { name: "Comment on T2" })).toHaveValue(
    "Worth a CK level here? @Daniel Hruška ",
  );
});

test("answering moves on, and the Slide done card gates the submit", async ({ page }) => {
  await page.goto(`/tasks/${rt14}/guided?slide=${a1}&scene=region`);
  await review(page).getByRole("button", { name: /Agree/ }).first().click();
  await expect(page.getByText("The AI says this is a tumor cell, only 54% sure.")).toBeVisible();
  await page.goto(`/tasks/${rt14}/guided?slide=${a1}&scene=required`);
  const submit = page.getByRole("button", { name: /Submit and open slide 9/ });
  await expect(submit).toBeDisabled();
  await page
    .getByRole("radiogroup", { name: "Is the AI result acceptable for this slide?" })
    .getByRole("radio", { name: "4" })
    .click();
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page).toHaveURL(/\/submitted\?/);
});

test("submitting with open threads warns and still goes through", async ({ page }) => {
  await page.goto(`/tasks/${rt14}/guided?slide=${a1}&scene=done`);
  const warning = page.locator('[data-slot="submit-warning"]');
  await expect(warning).toContainText("3 open threads on this slide. You can still submit.");
  const submit = page.getByRole("button", { name: /Submit and open slide 9/ });
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page).toHaveURL(/\/submitted\?/);
});

test("a slide with no open threads shows no submit warning", async ({ page }) => {
  await page.goto(`/tasks/${rt14}/guided?slide=${a2}&scene=done`);
  await expect(page.getByText("is done").first()).toBeVisible();
  await expect(page.locator('[data-slot="submit-warning"]')).toHaveCount(0);
});

const undoHost = (page: Page) => page.locator('[data-slot="undo-toast-host"]');

test("Undo takes a decision back inside 4 seconds and leaves the slide centre free", async ({
  page,
}) => {
  await page.clock.install();
  await page.goto(`/tasks/${rt14}/guided?slide=${a1}&scene=region`);
  await expect(page.getByText("The AI says T5 is tumor, 52% sure.")).toBeVisible();
  await review(page).getByRole("button", { name: /Agree/ }).first().click();
  await expect(page.getByText("The AI says this is a tumor cell, only 54% sure.")).toBeVisible();
  const toast = undoHost(page).locator('[data-slot="toast"]');
  await expect(toast).toContainText("T5");
  const box = await toast.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  if (box && viewport) {
    expect(box.y).toBeGreaterThan(viewport.height * 0.85);
  }
  await page.clock.fastForward(2500);
  await toast.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("The AI says T5 is tumor, 52% sure.")).toBeVisible();
  await expect(toast).toHaveCount(0);
});

test("the decision toast is gone after 4 seconds and the decision stays", async ({ page }) => {
  await page.clock.install();
  await page.goto(`/tasks/${rt14}/guided?slide=${a1}&scene=region`);
  await review(page).getByRole("button", { name: /Agree/ }).first().click();
  const toast = undoHost(page).locator('[data-slot="toast"]');
  await expect(toast).toBeVisible();
  await page.clock.fastForward(4100);
  await expect(toast).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Undo" })).toHaveCount(0);
  await expect(page.getByText("The AI says this is a tumor cell, only 54% sure.")).toBeVisible();
});

test("the next slide card, the cells gallery and the comments open on fake data", async ({
  page,
}) => {
  await page.goto(`/tasks/${rt14}/submitted?slide=${a1}`);
  const card = page.getByRole("dialog", { name: "Slide 8 submitted" });
  await expect(card).toContainText("You and Simona Marková agree on 51 of 55 objects.");
  await expect(card).toContainText("A2 · H&E · case S26-04812");
  await card.getByRole("button", { name: "Take a break" }).click();
  await expect(page).toHaveURL(/\/my-work/);

  const gallery: { scene: string; shows: string }[] = [
    { scene: "grid", shows: "Agree with the rest" },
    { scene: "rest", shows: "Agree with 6 open cells?" },
    { scene: "folded", shows: "Cells in your sample" },
    { scene: "blind", shows: "What is this cell?" },
  ];
  for (const { scene, shows } of gallery) {
    await page.goto(`/tasks/${rt14}/cells?slide=${a1}&scene=${scene}`);
    await expect(page.getByText("Objects on A1")).toBeVisible();
    await expect(page.getByText(shows).first()).toBeVisible();
  }

  await page.goto(`/tasks/${rt14}/comments?slide=${a1}&thread=T2`);
  await expect(page.getByText("Threads on A1")).toBeVisible();
  await expect(page.getByRole("region", { name: "Thread on T2" })).toContainText(
    "The model draws T2 past the fold.",
  );
});

test("the cells gallery shows the X action on cells that may not be nuclei and the X marks one disagree", async ({
  page,
}) => {
  await page.goto(`/tasks/${rt14}/cells?slide=${a1}&scene=grid`);
  await expect(page.getByRole("button", { name: "Agree with the rest" })).toBeVisible();
  const actions = page.locator('[data-slot="gallery-tile-flag-action"]');
  await expect(actions).toHaveCount(5);
  await expect(page.locator('[data-slot="gallery-tile"][data-flag]')).toHaveCount(5);
  await expect(page.getByRole("button", { name: /^T1·C101 .*may not be a nucleus/ })).toHaveCount(
    0,
  );
  const flaggedTile = page.getByRole("button", {
    name: "T5·C531 tumor 57%, to check, may not be a nucleus",
  });
  await expect(flaggedTile).toBeVisible();
  await page.getByRole("button", { name: "T5·C531 may not be a nucleus, disagree" }).click();
  await expect(actions).toHaveCount(4);
  await expect(page.getByRole("button", { name: "T5·C531 tumor 57%, disagree" })).toBeVisible();
});

test("the reopen box shows the submitted banner", async ({ page }) => {
  await page.goto(`/tasks/${rt14}/guided?slide=${a1}&scene=region&submitted=true`);
  await expect(
    page.getByText("You submitted this slide. Changes are saved and Simona is told."),
  ).toBeVisible();
});

const dot = (page: Page, object: string) =>
  page.getByRole("group", { name: "Objects" }).getByRole("button", { name: object, exact: true });

const openGuided = async (page: Page) => {
  await page.goto(`/tasks/${rt14}/guided?slide=${a1}&scene=region`);
  await expect(page.getByText("The AI says T5 is tumor, 52% sure.")).toBeVisible();
};

test("the dots carry a check, a cross and a question mark, and an open one carries none", async ({
  page,
}) => {
  await openGuided(page);
  await expect(dot(page, "T1").locator('[data-icon-name="check"]')).toHaveCount(1);
  await expect(dot(page, "T2").locator('[data-icon-name="close"]')).toHaveCount(1);
  await expect(dot(page, "T4")).toHaveText("?");
  await expect(dot(page, "T5")).toHaveText("");
  await expect(dot(page, "T5").locator("svg")).toHaveCount(0);
  await expect(dot(page, "T5")).toHaveAttribute("aria-current", "true");
});

test("a slide is reviewed with the mouse alone, and each answer moves on by itself", async ({
  page,
}) => {
  await openGuided(page);
  await review(page)
    .getByRole("button", { name: /Not sure/ })
    .first()
    .click();
  await expect(page.getByText("The AI says this is a tumor cell, only 54% sure.")).toBeVisible();
  await expect(dot(page, "T5")).toHaveText("?");
  await expect(page.getByRole("button", { name: /^Back to / })).toBeVisible();
  await page.getByRole("button", { name: "Whole slide" }).click();
  await expect(page.getByRole("button", { name: "Whole slide" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: "Whole slide" }).click();
  await dot(page, "T5").click();
  await expect(page.getByText("The AI says T5 is tumor, 52% sure.")).toBeVisible();
  await review(page).getByRole("button", { name: /Agree/ }).first().click();
  const position = page.getByText(/^Object \d+ of 55 on this slide$/);
  for (let cell = 0; cell < 5; cell += 1) {
    const at = await position.innerText();
    await review(page).getByRole("button", { name: /Agree/ }).first().click();
    await expect(position).not.toHaveText(at);
  }
  await review(page).getByRole("button", { name: /Agree/ }).first().click();
  await expect(page.getByText("Slide 8 is done")).toBeVisible();
  await expect(page.getByRole("link", { name: /My work/ }).first()).toBeVisible();
});

test("a slide is reviewed with the keyboard alone", async ({ page }) => {
  await openGuided(page);
  await page.keyboard.press("k");
  await expect(page.getByText("The AI says this is a tumor cell, only 54% sure.")).toBeVisible();
  await expect(dot(page, "T5").locator('[data-icon-name="check"]')).toHaveCount(1);
  const position = page.getByText(/^Object \d+ of 55 on this slide$/);
  const before = await position.innerText();
  await page.keyboard.press("ArrowLeft");
  await expect(position).not.toHaveText(before);
  await page.keyboard.press("ArrowRight");
  await expect(position).toHaveText(before);
  await page.keyboard.press("u");
  for (let cell = 0; cell < 5; cell += 1) await page.keyboard.press("k");
  await expect(page.getByText("Slide 8 is done")).toBeVisible();
  await expect(page.getByRole("img", { name: /, 0 open$/ })).toBeVisible();
});
