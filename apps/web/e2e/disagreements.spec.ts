import { expect, type Page, test } from "./a11y.ts";

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

const engine = (page: Page) => page.getByTestId("still-engine");

const goInApp = (page: Page, url: string) =>
  page.evaluate((target) => {
    window.history.pushState({}, "", target);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, url);

async function slideDrawn(page: Page) {
  await expect(engine(page)).toHaveAttribute("data-state", "ready", { timeout: 20_000 });
  await expect(engine(page).locator("canvas").first()).toBeVisible();
  await expect(page.locator('[data-slot="slide-still"] svg image')).toHaveCount(0);
}

const scenes: { path: string; persona: string; sees: string; dialog?: string }[] = [
  { path: "disagreements?stage=open", persona: "Daniel Hruška", sees: "0 resolved" },
  { path: "disagreements?stage=sent", persona: "Daniel Hruška", sees: "3 with the adjudicator" },
  { path: "adjudicate?stage=sent", persona: "Anna Kopecká", sees: "0 of 3 decided" },
  { path: "adjudicate?stage=adjudicated", persona: "Anna Kopecká", sees: "All 3 decided" },
  {
    path: "disagreements?stage=locked",
    persona: "Daniel Hruška",
    sees: "Simona Marková has 8 slides left",
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
    sees: "Single sign-on did not answer",
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
    path: "evaluation?view=pdf",
    persona: "Daniel Hruška",
    sees: "evaluation_v1_report.pdf",
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

test("the sign-off page of a task signed before shows the signed state and opens the report", async ({
  page,
}) => {
  const rt09 = "00000000-0000-4000-8007-000000000009";
  await page.goto(`/tasks/${rt09}/sign-off`);
  const modal = page.getByRole("dialog", { name: "Sign off RT-09" });
  await expect(modal).toContainText("signed");
  await expect(modal).toContainText("Checksum");
  await modal.getByRole("button", { name: "Open the evaluation report" }).click();
  await expect(page).toHaveURL(new RegExp(`/tasks/${rt09}/evaluation`));
});

test("the sign-off page of an annotate task says slides are signed off in the viewer", async ({
  page,
}) => {
  const annotateTask = "00000000-0000-4000-8007-000000000021";
  await page.goto(`/tasks/${annotateTask}/sign-off`);
  await expect(page.getByTestId("sign-off-annotate")).toBeVisible();
  await page.getByRole("button", { name: "Open the task" }).click();
  await expect(page).toHaveURL(/\/slides\/[^/?]+\?.*mode=annotate.*tab=objects/);
});

test("the report's Methods block says how the decisions were counted", async ({ page }) => {
  await page.goto(`${base}/evaluation?scene=report`);
  const methods = page.locator("[data-methods]").first();
  await expect(methods).toContainText("Reviewers answered in the Agree with the AI style.");
  await expect(methods).toContainText("The answers as given were");
});

test("no disagreements page reads a scene or offers a preview of another person's view", async ({
  page,
}) => {
  await page.goto(`${base}/disagreements?stage=open&scene=adjudicate`);
  await expect(page.getByRole("heading", { name: "Disagreements in RT-14" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Preview the adjudicator view" })).toHaveCount(0);
  await expect(badge(page)).toContainText("Daniel Hruška");
});

test("the disagreements stage draws the slide under the object", async ({ page }) => {
  await page.goto(`${base}/disagreements?stage=open`);
  await slideDrawn(page);
  await page.getByRole("button", { name: /^T4 / }).click();
  await slideDrawn(page);
});

test("a declined object shows the note and can go to someone else", async ({ page }) => {
  await page.goto(`${base}/disagreements?stage=declined`);
  await page.getByRole("button", { name: /^T4 / }).click();
  const decide = page.getByRole("complementary", { name: "Decide" });
  await expect(decide).toContainText("Not my area, ask Jan.");
  await expect(decide.getByRole("button", { name: "Send to someone else" })).toBeVisible();
});

test("an object redrawn after the decisions asks to look again", async ({ page }) => {
  await page.goto(`${base}/disagreements?stage=edited`);
  await page.getByRole("button", { name: /^T2 / }).click();
  await expect(page.getByText("after both reviewers decided")).toBeVisible();
});

test("Edit myself opens the viewer at that object", async ({ page }) => {
  await page.goto(`${base}/disagreements?stage=open`);
  await page.getByRole("button", { name: /^T4 / }).click();
  await page.getByRole("button", { name: "Edit T4 myself in the viewer" }).click();
  await expect(page).toHaveURL(new RegExp(`/slides/[^?]+\\?task=${rt14}&object=T4`));
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Disagreements in RT-14" })).toBeVisible();
});

test("the prototype index links the queue and the adjudication without scenes", async ({
  page,
}) => {
  await page.goto("/prototype");
  const screens = page.getByRole("list", { name: "Screens" });
  await expect(screens.getByRole("link", { name: /^Disagreements/ })).toHaveCount(1);
  await expect(screens.getByRole("link", { name: /^Sign-off/ })).toHaveCount(5);
  await expect(screens.getByRole("link", { name: /^Evaluation report/ })).toHaveCount(5);
  await screens.getByRole("link", { name: /^Adjudication/ }).click();
  await expect(page).toHaveURL(/\/adjudicate$/);
  await expect(page.getByText("Daniel asked you to decide")).toBeVisible();
});

test("deciding a row moves on, and two rows go to Anna", async ({ page }) => {
  await page.goto(`${base}/disagreements?stage=open`);
  const decide = page.getByRole("complementary", { name: "Decide" });
  await page.getByRole("button", { name: /^T2 / }).click();
  await decide.getByRole("button", { name: /Disagree/ }).click();
  await expect(page.getByText("1 resolved")).toBeVisible();
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
  await page.goto(`${base}/disagreements?stage=open`);
  const decide = page.getByRole("complementary", { name: "Decide" });
  const signOff = page.getByRole("button", { name: "Go to sign-off" });
  await expect(signOff).toHaveAttribute("title", "Sign-off lists what is still open");
  await page.getByRole("button", { name: /^T2 / }).click();
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

test("Daniel sends T4 to Anna, she decides it on the drawn slide, and sign-off shows it", async ({
  page,
}) => {
  await page.goto(`${base}/disagreements?stage=open`);
  await page.getByRole("checkbox", { name: "Select T4 on A1" }).click();
  const decide = page.getByRole("complementary", { name: "Decide" });
  await decide.getByRole("button", { name: "Send to an adjudicator" }).click();
  const modal = page.getByRole("dialog", { name: "Send to an adjudicator" });
  await modal.getByRole("combobox").fill("Anna");
  await modal.getByRole("option", { name: /Anna Kopecká/ }).click();
  await modal.getByRole("button", { name: /Send 1 object/ }).click();
  await expect(page.getByText("1 with the adjudicator")).toBeVisible();

  await goInApp(page, `${base}/adjudicate`);
  await expect(badge(page)).toContainText("Anna Kopecká");
  await expect(page.getByText("0 of 1 decided").first()).toBeVisible();
  await slideDrawn(page);
  await page.getByRole("textbox", { name: /Note for the record/ }).fill("Reactive sinus");
  await page.getByRole("button", { name: /Disagree/ }).click();
  await expect(page.getByText(/All 1 decided/).first()).toBeVisible();

  await goInApp(page, `${base}/sign-off`);
  const signOff = page.getByRole("dialog", { name: "Sign off RT-14" });
  const rows = signOff.getByRole("list", { name: "Adjudications" });
  await expect(rows).toContainText("T4");
  await expect(rows).toContainText("Anna Kopecká");
  await expect(rows).toContainText("Disagree");
  await expect(rows).toContainText("Reactive sinus");
  await expect(rows).toContainText("Kept beside 2 reviewer decisions");
});

test("the evaluation lists each adjudication beside the reviewers' decisions", async ({ page }) => {
  await page.goto(`${base}/evaluation`);
  const rows = page.getByRole("list", { name: "Adjudications" });
  await expect(rows.getByRole("listitem")).toHaveCount(3);
  await expect(rows).toContainText("Anna Kopecká");
});

test("the adjudicator decides all three and the researcher sees them in the queue", async ({
  page,
}) => {
  await page.goto(`${base}/adjudicate?stage=sent`);
  await expect(page.getByText("Reviewer A", { exact: true })).toBeVisible();
  await expect(page.getByText("Lenka Malá")).toHaveCount(0);
  await expect(page.getByText("One reviewer asked for a second look, the other")).toBeVisible();
  await expect(page.getByText("The AI says T4 is tumor, 58% sure.")).toBeVisible();
  await page.keyboard.press("x");
  await expect(
    page.getByText("One reviewer agrees with the AI, the other disagrees"),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: /Note for the record/ })
    .fill("Crush artefact at the edge");
  await page.getByRole("button", { name: /Disagree/ }).click();
  await expect(page.getByText("The AI says this is a tumor cell")).toBeVisible();
  await expect(page.getByText("Both reviewers disagree with the AI")).toBeVisible();
  await page.getByRole("button", { name: /Not sure/ }).click();
  await expect(page.getByText("All 3 decided. Daniel is told.")).toBeVisible();
  await goInApp(page, `${base}/disagreements`);
  await expect(page.getByText("3 resolved")).toBeVisible();
  const done = page.getByRole("row", { name: /T5/ });
  await expect(done).toContainText("Disagree");
  await expect(page.getByRole("row", { name: /T1·C145/ })).toContainText("Not sure");
});

test("the adjudicator can go back to My work once everything is decided", async ({ page }) => {
  await page.goto(`${base}/adjudicate?stage=sent`);
  for (let at = 0; at < 3; at += 1) await page.getByRole("button", { name: /Agree/ }).click();
  await page.getByRole("button", { name: "Back to My work" }).click();
  await expect(page).toHaveURL(/\/my-work$/);
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

test("a started v2 offers Sign v2, which opens the checks for v2", async ({ page }) => {
  await page.goto(`${base}/sign-off?scene=amend`);
  const amend = page.getByRole("dialog", { name: "Start Evaluation v2" });
  await amend.getByRole("textbox", { name: "Reason" }).fill("Measured again on deeper levels");
  await amend.getByRole("button", { name: /Start v2/ }).click();
  const modal = page.getByRole("dialog", { name: "Sign off RT-14" });
  await expect(modal.getByText("Evaluation v2 · draft")).toBeVisible();
  await expect(modal.getByRole("button", { name: "Start v2" })).toHaveCount(0);
  await modal.getByRole("button", { name: "Sign v2" }).click();
  await expect(page.getByRole("dialog", { name: "Sign off RT-14 · v2" })).toBeVisible();
});

test("the report arranges blocks, previews the PDF and keeps the arrangement", async ({ page }) => {
  await page.goto(`${base}/evaluation`);
  await page.getByRole("button", { name: "Arrange blocks and format" }).click();
  await expect(page).toHaveURL(/scene=arrange/);
  await page.getByRole("group", { name: "Block 1, Results" }).getByRole("button").first().click();
  await page.getByRole("button", { name: "Move down" }).first().click();
  await page.getByRole("button", { name: "Save for this task" }).click();
  await expect(page.getByText("Arranged for this task.").first()).toBeVisible();
  await page.getByRole("button", { name: "Preview the PDF" }).click();
  const preview = page.getByRole("dialog", { name: "PDF preview" });
  await preview.getByRole("button", { name: "Page 3" }).click();
  await expect(preview.getByText("3 / 3")).toBeVisible();
  await preview.getByRole("button", { name: "Close the preview" }).click();
  await expect(preview).toHaveCount(0);
  await expect(page.getByText("Arranged for this task.").first()).toBeVisible();
});
