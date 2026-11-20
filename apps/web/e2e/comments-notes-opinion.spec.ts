import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const rt14 = "00000000-0000-4000-8007-000000000014";
const a1 = "00000000-0000-4000-8005-000000000001";
const objectsViewer = `/projects/${p07}/slides/${a1}?task=${rt14}`;

test.use({ viewport: { width: 1440, height: 900 } });

async function ready(page: Page) {
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
    timeout: 20_000,
  });
}

test("a decision note is listed under Your decision notes and a thread opens at its pin", async ({
  page,
}) => {
  await page.goto(objectsViewer);
  await ready(page);
  const row = page.locator('[data-testid="object-row"][data-object="T2"]');
  await row.getByRole("button").click();
  await page
    .getByTestId("object-foot")
    .getByRole("group", { name: "Your answer on T2" })
    .getByRole("button", { name: /Disagree/ })
    .click();
  await page
    .getByTestId("object-foot")
    .getByRole("button", { name: /Add a note/ })
    .click();
  await page.getByRole("button", { name: "Boundary is off" }).click();
  const field = page.getByRole("textbox", { name: "Note on your decision for T2" });
  await field.pressSequentially("Runs past the fold");
  await page.keyboard.press("Enter");
  const stage = page.getByTestId("slide-stage");
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0 };
  await page.mouse.click(box.x + 20, box.y + 20);
  await page.keyboard.press("c");
  await page.mouse.click(box.x + 600, box.y + 500);
  const composer = page.getByRole("textbox", { name: "Comment at the pin" });
  await expect(composer).toBeFocused();
  await composer.fill("Is this edge real?");
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-slot="comment-pin"]')).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("pin-thread")).toHaveCount(0);
  const comments = page.getByTestId("stage-comments");
  await expect(comments.getByRole("button", { name: /New comment on an ID/ })).toBeVisible();
  const notes = comments.locator('[data-slot="decision-notes"]');
  await expect(notes).toContainText("Your decision notes");
  await expect(notes).toContainText("T2");
  await expect(notes).toContainText("Disagree");
  await expect(notes).toContainText("Runs past the fold");
  await comments
    .locator('[data-slot="thread-card"]')
    .filter({ hasText: "Is this edge real?" })
    .getByRole("button")
    .first()
    .click();
  await expect(page.getByTestId("pin-thread")).toBeVisible();
  await expect(notes).toBeVisible();
});

test("the Opinion tab is the form only and the one Submit names what is still open", async ({
  page,
}) => {
  await page.goto(`${objectsViewer}&tab=opinion`);
  await ready(page);
  const opinion = page.getByTestId("stage-opinion");
  await expect(opinion).toHaveAttribute("data-form-only", "true");
  await expect(page.getByRole("list", { name: "Before you submit" })).toHaveCount(0);
  const submit = page.getByTestId("top-submit");
  await expect(submit).toBeDisabled();
  await expect(submit).toHaveAttribute("title", /open/);
});
