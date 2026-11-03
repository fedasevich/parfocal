import { expect, type Page, test } from "@playwright/test";

const newTask = "/projects/00000000-0000-4000-8003-000000000007/tasks/new";

const scenes: { scene: string; step: string; sees: string }[] = [
  { scene: "slides", step: "Slides", sees: "12 picked. 9 have CAMELYON v1.0, 3 are left out." },
  { scene: "reviewers", step: "Reviewers", sees: "Everyone reviews all" },
  { scene: "find", step: "Reviewers", sees: "Away until 22 Oct" },
  { scene: "check", step: "What to check", sees: "About 55 objects per slide and 3 hours" },
  {
    scene: "decision",
    step: "What to check",
    sees: "5 counts as agree with the AI, 3 and 4 as not sure, and 1 and 2 as disagree.",
  },
  { scene: "how", step: "How it runs", sees: "Display defaults for reviewers" },
  { scene: "locks", step: "How it runs", sees: "Why it is locked" },
  { scene: "send", step: "Send", sees: "Check before you send" },
  { scene: "noresult", step: "Slides", sees: "None of the picked slides has CAMELYON v1.0." },
  { scene: "pastdue", step: "How it runs", sees: "The due date is in the past. Pick a later day." },
  { scene: "away", step: "Reviewers", sees: "Petra Králová is away until 22 Oct." },
  { scene: "retiredtpl", step: "Slides", sees: "The project's default template was retired." },
  { scene: "nobody", step: "Reviewers", sees: "Pick at least one reviewer." },
];

const flow = (page: Page) => page.getByTestId("new-task");

for (const { scene, step, sees } of scenes) {
  test(`the ${scene} scene opens on ${step}`, async ({ page }) => {
    await page.goto(`${newTask}?scene=${scene}`);
    await expect(flow(page).getByRole("heading", { name: "New review task" })).toBeVisible();
    await expect(flow(page).locator('[aria-current="step"]')).toHaveText(new RegExp(step));
    await expect(flow(page).getByText(sees).first()).toBeVisible();
  });
}

test("the sent scene says RT-16 is out and offers Team", async ({ page }) => {
  await page.goto(`${newTask}?scene=sent`);
  await expect(page.getByRole("heading", { name: "RT-16 is out" })).toBeVisible();
  await expect(page.getByText("Sent to 2 reviewers on 15 Oct")).toBeVisible();
  await expect(page.getByRole("link", { name: "Track it in Team" })).toHaveAttribute(
    "href",
    "/team?task=00000000-0000-4000-8043-000000000016",
  );
});

test("Add slides and Preview open as small modals", async ({ page }) => {
  await page.goto(`${newTask}?scene=slides&modal=addslides`);
  const add = page.getByRole("dialog", { name: "Add slides" });
  await expect(add).toBeVisible();
  await add.getByRole("checkbox", { name: "tumor_088" }).click();
  await add.getByRole("button", { name: "Add 1 slide" }).click();
  await expect(add).toBeHidden();
  await expect(flow(page).getByText("Loose · added")).toBeVisible();

  await page.goto(`${newTask}?scene=check&modal=dpreview`);
  const preview = page.getByRole("dialog", { name: "Preview the question" });
  await expect(preview.getByText("How sure are you that T2 is tumor?")).toBeVisible();
  await preview.getByRole("button", { name: /Probably not/ }).click();
  await expect(preview.getByText("What is wrong")).toBeVisible();
  await preview.getByRole("button", { name: /^Done/ }).click();
  await expect(preview).toBeHidden();
});

test("Next walks every step, Change goes back, and Send creates RT-16", async ({ page }) => {
  await page.goto(`${newTask}?scene=slides`);
  const next = flow(page).getByRole("button", { name: "Next" });
  for (const step of ["Reviewers", "What to check", "How it runs", "Send"]) {
    await next.click();
    await expect(flow(page).locator('[aria-current="step"]')).toHaveText(new RegExp(step));
  }
  await flow(page).getByRole("button", { name: "Change" }).nth(1).click();
  await expect(flow(page).locator('[aria-current="step"]')).toHaveText(/Reviewers/);
  await flow(page).getByRole("button", { name: /Send/ }).click();
  await flow(page).getByRole("button", { name: "Create and notify 2 reviewers" }).click();
  await expect(page.getByRole("heading", { name: "RT-16 is out" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Track it in Team" })).toHaveAttribute(
    "href",
    "/team?task=00000000-0000-4000-8043-000000000016",
  );
});

test("Send invites a new reviewer by email to the created task", async ({ page }) => {
  await page.goto(`${newTask}?scene=reviewers`);
  const who = flow(page).getByRole("combobox", { name: "Who reviews" });
  await who.fill("nova@lab.example");
  await flow(page).getByText("Invite nova@lab.example by email").click();
  for (const step of ["What to check", "How it runs", "Send"]) {
    await flow(page).getByRole("button", { name: "Next" }).click();
    await expect(flow(page).locator('[aria-current="step"]')).toHaveText(new RegExp(step));
  }
  const invited = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      /\/api\/review-tasks\/00000000-0000-4000-8043-000000000016\/invitations$/.test(request.url()),
  );
  await flow(page).getByRole("button", { name: "Create, notify 2 reviewers and invite 1" }).click();
  expect((await invited).postDataJSON()).toEqual({ email: "nova@lab.example" });
  await expect(page.getByRole("heading", { name: "RT-16 is out" })).toBeVisible();
});

test("Next on a blocked step keeps the step and focuses the field", async ({ page }) => {
  await page.goto(`${newTask}?scene=nobody`);
  const next = flow(page).getByRole("button", { name: "Next" });
  await expect(next).toHaveAttribute("aria-disabled", "true");
  await next.click({ force: true });
  await expect(flow(page).locator('[aria-current="step"]')).toHaveText(/Reviewers/);
  await expect(flow(page).getByRole("combobox", { name: "Who reviews" })).toBeFocused();
});
