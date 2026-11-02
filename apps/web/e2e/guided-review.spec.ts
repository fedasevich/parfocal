import { expect, type Page, test } from "@playwright/test";

const rt14 = "00000000-0000-4000-8007-000000000014";
const a1 = "00000000-0000-4000-8005-000000000001";
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

test("every guided review scene opens on fake data", async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const { scene, shows, slide } of guided) {
    await page.goto(`/tasks/${rt14}/guided?slide=${slide ?? a1}&scene=${scene}`);
    await expect(page.getByText("Round 2 · CAMELYON v1.0")).toBeVisible();
    await expect(page.getByText(shows).first()).toBeVisible();
  }
  expect(errors).toEqual([]);
});

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

test("the reopen box shows the submitted banner", async ({ page }) => {
  await page.goto(`/tasks/${rt14}/guided?slide=${a1}&scene=region&submitted=true`);
  await expect(
    page.getByText("You submitted this slide. Changes are saved and Simona is told."),
  ).toBeVisible();
});
