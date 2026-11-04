import { expect, type Page, test } from "@playwright/test";

const rt14 = "00000000-0000-4000-8007-000000000014";
const base = `/tasks/${rt14}`;

const badge = (page: Page) => page.getByTestId("fake-data-badge");

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("Failed to load resource")) {
      errors.push(message.text());
    }
  });
  return errors;
}

const scenes: { path: string; persona: string; sees: string; dialog?: string }[] = [
  { path: "disagreements?scene=queue", persona: "Daniel Hruška", sees: "0 resolved" },
  { path: "disagreements?scene=selected", persona: "Daniel Hruška", sees: "3 objects selected" },
  {
    path: "disagreements?scene=sendadj",
    persona: "Daniel Hruška",
    sees: "Reviewers stay anonymous",
    dialog: "Send to an adjudicator",
  },
  { path: "disagreements?scene=sent", persona: "Daniel Hruška", sees: "3 with the adjudicator" },
  { path: "disagreements?scene=adjudicate", persona: "Anna Kopecká", sees: "0 of 3 decided" },
  { path: "disagreements?scene=adjdone", persona: "Anna Kopecká", sees: "All 3 decided" },
  {
    path: "disagreements?scene=lockedqueue",
    persona: "Daniel Hruška",
    sees: "Simona Marková has 8 slides left",
  },
  {
    path: "disagreements?scene=declined",
    persona: "Daniel Hruška",
    sees: "Not my area, ask Jan.",
  },
  {
    path: "disagreements?scene=edited",
    persona: "Daniel Hruška",
    sees: "after both reviewers decided",
  },
  {
    path: "sign-off?scene=blocked",
    persona: "Daniel Hruška",
    sees: "13 reviews not submitted",
    dialog: "Sign off RT-14",
  },
  {
    path: "sign-off?scene=ready",
    persona: "Daniel Hruška",
    sees: "2 objects left open on purpose",
    dialog: "Sign off RT-14",
  },
  {
    path: "sign-off?scene=ssofail",
    persona: "Daniel Hruška",
    sees: "Vltava single sign-on did not answer",
    dialog: "Sign off RT-14",
  },
  {
    path: "sign-off?scene=signed",
    persona: "Daniel Hruška",
    sees: "sha256:8c1f…a90e",
    dialog: "Sign off RT-14",
  },
  {
    path: "sign-off?scene=amend",
    persona: "Daniel Hruška",
    sees: "Give a reason of at least 10 characters.",
    dialog: "Start Evaluation v2",
  },
  { path: "evaluation?scene=report", persona: "Daniel Hruška", sees: "Cells agreed" },
  { path: "evaluation?scene=arrange", persona: "Daniel Hruška", sees: "Outline" },
  {
    path: "evaluation?scene=pdf",
    persona: "Daniel Hruška",
    sees: "RT-14_evaluation_v1.pdf",
    dialog: "PDF preview",
  },
  {
    path: "evaluation?scene=retiredtpl",
    persona: "Daniel Hruška",
    sees: "This report keeps it. New tasks use v3.",
  },
  {
    path: "evaluation?scene=exportfail",
    persona: "Daniel Hruška",
    sees: "The PDF could not be made",
  },
];

for (const { path, persona, sees, dialog } of scenes) {
  test(`${path} opens on fake data as ${persona}`, async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(`${base}/${path}`);
    await expect(page.getByText(sees).first()).toBeVisible();
    if (dialog) await expect(page.getByRole("dialog", { name: dialog })).toBeVisible();
    await expect(badge(page)).toContainText(persona);
    await expect(page.getByText(/^Placeholder\. The screen is built by/)).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

test("sign-off warns about open threads and still lets the researcher sign", async ({ page }) => {
  await page.goto(`${base}/sign-off?scene=ready`);
  const modal = page.getByRole("dialog", { name: "Sign off RT-14" });
  await expect(modal).toContainText("3 threads still open");
  await expect(modal).toContainText("3 on A1");
  await expect(modal).toContainText("they do not block signing");
  await expect(modal.getByRole("button", { name: /^Sign/ }).last()).toBeEnabled();
});

test("the report's Methods block says how the decisions were counted", async ({ page }) => {
  await page.goto(`${base}/evaluation?scene=report`);
  const methods = page.locator("[data-methods]").first();
  await expect(methods).toContainText("Reviewers answered in the Agree with the AI style.");
  await expect(methods).toContainText("The answers as given were");
});

test("the prototype index opens every scene of the three screens", async ({ page }) => {
  await page.goto("/prototype");
  const screens = page.getByRole("list", { name: "Screens" });
  await expect(screens.getByRole("link", { name: /^Disagreements/ })).toHaveCount(7);
  await expect(screens.getByRole("link", { name: /^Sign-off/ })).toHaveCount(5);
  await expect(screens.getByRole("link", { name: /^Evaluation report/ })).toHaveCount(5);
  await screens.getByRole("link", { name: "Adjudication · first object" }).click();
  await expect(page).toHaveURL(/\/disagreements\?scene=adjudicate$/);
  await expect(page.getByText("Daniel asked you to decide")).toBeVisible();
});

test("deciding a row moves on, and three rows go to Anna", async ({ page }) => {
  await page.goto(`${base}/disagreements?scene=queue`);
  const decide = page.getByRole("complementary", { name: "Decide" });
  await decide.getByRole("button", { name: /Disagree/ }).click();
  await expect(page.getByText("1 resolved")).toBeVisible();
  await expect(decide.getByText("second look asked")).toBeVisible();
  await page.keyboard.press("x");
  await expect(page.getByText("2 resolved")).toBeVisible();
  await page.getByRole("checkbox", { name: "Select T5 on A1" }).click();
  await page.getByRole("checkbox", { name: "Select T1·C145 on A1" }).click();
  await expect(decide.getByText("2 objects selected")).toBeVisible();
  await decide.getByRole("button", { name: "Send to an adjudicator" }).click();
  const modal = page.getByRole("dialog", { name: "Send to an adjudicator" });
  await modal.getByRole("button", { name: /Send 2 objects/ }).click();
  await expect(modal.getByText("Pick who decides.").first()).toBeVisible();
  await modal.getByRole("combobox").fill("Anna");
  await modal.getByRole("option", { name: /Anna Kopecká/ }).click();
  await modal.getByRole("button", { name: /Send 2 objects/ }).click();
  await expect(modal).toHaveCount(0);
  await expect(page.getByText("2 with the adjudicator")).toBeVisible();
  await page.getByRole("button", { name: "Go to sign-off" }).click();
  await expect(page.getByRole("dialog", { name: "Sign off RT-14" })).toContainText(
    "disagreements not resolved",
  );
});

test("a queue resolves with decisions, three objects sent to Anna and two left open", async ({
  page,
}) => {
  await page.goto(`${base}/disagreements?scene=queue`);
  const decide = page.getByRole("complementary", { name: "Decide" });
  const signOff = page.getByRole("button", { name: "Go to sign-off" });
  await expect(signOff).toHaveAttribute("title", "Sign-off lists what is still open");
  await decide.getByRole("button", { name: /Agree/ }).click();
  await expect(page.getByText("1 resolved")).toBeVisible();
  for (const label of ["T4 on A1", "T5 on A1", "T1·C145 on A1"]) {
    await page.getByRole("checkbox", { name: `Select ${label}` }).click();
  }
  await decide.getByRole("button", { name: "Send to an adjudicator" }).click();
  const modal = page.getByRole("dialog", { name: "Send to an adjudicator" });
  await modal.getByRole("combobox").fill("Anna");
  await modal.getByRole("option", { name: /Anna Kopecká/ }).click();
  await modal.getByRole("button", { name: /Send 3 objects/ }).click();
  await expect(modal).toHaveCount(0);
  await expect(page.getByText("3 with the adjudicator")).toBeVisible();
  await page.getByRole("button", { name: /^T1·C212/ }).click();
  await decide.getByRole("button", { name: "Leave open" }).click();
  await page.getByRole("button", { name: /^T1 tumor_031/ }).click();
  await decide.getByRole("button", { name: "Leave open" }).click();
  await expect(signOff).toHaveAttribute("title", "Sign-off lists what is still open");
  await page.getByRole("button", { name: /^T2·C88/ }).click();
  await decide.getByRole("button", { name: /Disagree/ }).click();
  await expect(signOff).toHaveAttribute(
    "title",
    "Every object is decided, left open or with the adjudicator",
  );
  await expect(page.getByText("4 resolved · 3 with the adjudicator")).toBeVisible();
});

test("the adjudicator decides all three and goes back to My work", async ({ page }) => {
  await page.goto(`${base}/disagreements?scene=adjudicate`);
  await expect(page.getByText("Reviewer A", { exact: true })).toBeVisible();
  await expect(page.getByText("Lenka Malá")).toHaveCount(0);
  for (const label of ["T4", "T5", "T1·C145"]) {
    await expect(page.getByText(`The AI says ${label} is`)).toBeVisible();
    await page.getByRole("button", { name: /Disagree/ }).click();
  }
  await expect(page.getByText("All 3 decided. Daniel is told.")).toBeVisible();
  await page.getByRole("button", { name: "Back to My work" }).click();
  await expect(page).toHaveURL(/\/my-work\?scene=anna/);
});

test("signing with single sign-on shows the signed version, and v2 needs a reason", async ({
  page,
}) => {
  await page.goto(`${base}/sign-off?scene=ssofail`);
  const modal = page.getByRole("dialog", { name: "Sign off RT-14" });
  await modal.getByRole("button", { name: "Try again" }).click();
  await expect(modal.getByText("Evaluation v1 · signed")).toBeVisible();
  await modal.getByRole("button", { name: "Start v2" }).click();
  const amend = page.getByRole("dialog", { name: "Start Evaluation v2" });
  await amend.getByRole("button", { name: /Start v2/ }).click();
  await expect(amend.getByText("Give a reason of at least 10 characters.").first()).toBeVisible();
  await amend.getByRole("textbox", { name: "Reason" }).fill("Measured again on deeper levels");
  await amend.getByRole("button", { name: /Start v2/ }).click();
  await expect(modal.getByText("Evaluation v2 · draft")).toBeVisible();
  await modal.getByRole("button", { name: /Open the evaluation report/ }).click();
  await expect(page).toHaveURL(/\/evaluation$/);
  await expect(
    page.getByRole("heading", { name: /Round 2 · CAMELYON tumor model v1.0/ }),
  ).toBeVisible();
});

test("the report arranges blocks, previews the PDF and keeps the arrangement", async ({ page }) => {
  await page.goto(`${base}/evaluation`);
  await page.getByRole("button", { name: "Arrange blocks and format" }).click();
  await expect(page).toHaveURL(/scene=arrange/);
  await page.getByRole("button", { name: "Select the block Results" }).first().click();
  await page.getByRole("button", { name: "Down", exact: true }).click();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByText("Arranged for this task.")).toBeVisible();
  await page.getByRole("button", { name: "Preview the PDF" }).click();
  const preview = page.getByRole("dialog", { name: "PDF preview" });
  await preview.getByRole("button", { name: "Page 3" }).click();
  await expect(preview.getByText("3 / 3")).toBeVisible();
  await preview.getByRole("button", { name: "Close the preview" }).click();
  await expect(preview).toHaveCount(0);
  await expect(page.getByText("Arranged for this task.")).toBeVisible();
});
