import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "./a11y.ts";

const rt14 = "00000000-0000-4000-8007-000000000014";
const p07 = "00000000-0000-4000-8003-000000000007";
const a1 = "00000000-0000-4000-8005-000000000001";

test.use({ viewport: { width: 1280, height: 900 } });

const answers = (page: Page, object: string) =>
  page.getByRole("group", { name: `Your answer on ${object}` });
const field = (page: Page, object: string) =>
  page.getByRole("textbox", { name: `Note on your decision for ${object}` });

const goInApp = (page: Page, url: string) =>
  page.evaluate((target) => {
    window.history.pushState({}, "", target);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, url);

async function disagreeOnT5(page: Page) {
  await page.goto(`/tasks/${rt14}/guided?slide=${a1}&scene=region`);
  await answers(page, "T5")
    .getByRole("button", { name: /Disagree/ })
    .click();
  await expect(page.getByText("You disagree with the AI on T5")).toBeVisible();
}

test("a note with a quick reason and a mention saves on Enter, and Esc cancels", async ({
  page,
}) => {
  await disagreeOnT5(page);
  await page.getByRole("button", { name: /Add a note/ }).click();
  await expect(field(page, "T5")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(field(page, "T5")).toHaveCount(0);
  await expect(page.getByText("You disagree with the AI on T5")).toBeVisible();

  await page.keyboard.press("Shift+N");
  await expect(field(page, "T5")).toBeFocused();
  const reason = page.getByRole("button", { name: "Boundary is off" });
  await reason.click();
  await expect(reason).toHaveAttribute("aria-pressed", "true");
  await field(page, "T5").pressSequentially("Runs past the fold @Dan");
  await expect(page.getByRole("listbox", { name: "Mention someone" })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(field(page, "T5")).toHaveValue(/Runs past the fold @Daniel Hruška $/);
  await field(page, "T5").pressSequentially("worth a second look");
  await page.keyboard.press("Enter");
  await expect(field(page, "T5")).toHaveCount(0);
  const saved = page.getByText("Note on decision: Disagree");
  await expect(saved).toBeVisible();
  await expect(page.getByText("@Daniel Hruška")).toBeVisible();
  await expect(page.getByText("worth a second look")).toBeVisible();
});

test("the open note field has no accessibility violations", async ({ page }) => {
  await disagreeOnT5(page);
  await page.getByRole("button", { name: /Add a note/ }).click();
  await expect(field(page, "T5")).toBeVisible();
  const results = await new AxeBuilder({ page }).include("[data-slot=note-editor]").analyze();
  expect(results.violations).toEqual([]);
});

test("a note written in guided review shows in the Comments tab and the adjudicator view", async ({
  page,
}) => {
  await disagreeOnT5(page);
  await page.keyboard.press("Shift+N");
  await field(page, "T5").fill("Folded edge, ask @Daniel Hruška");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Folded edge, ask")).toBeVisible();

  await goInApp(page, `/projects/${p07}/slides/${a1}?task=${rt14}&object=T5&tab=comments`);
  const notes = page.getByRole("region", { name: "Decision notes on T5" });
  await expect(notes).toContainText("Note on decision: Disagree");
  await expect(notes).toContainText("Folded edge, ask @Daniel Hruška");
  await notes.getByRole("button", { name: "Edit" }).click();
  await expect(field(page, "T5")).toHaveValue("Folded edge, ask @Daniel Hruška");
  await page.keyboard.press("Escape");

  await goInApp(page, `/tasks/${rt14}/disagreements?scene=adjudicate`);
  await page.getByRole("button", { name: /^T5, / }).click();
  const quote = page.locator("[data-slot=quoted-note]", { hasText: "Folded edge, ask" });
  await expect(quote).toContainText("@Daniel Hruška");
  await expect(page.getByText("Reviewer B")).toBeVisible();
  await expect(page.getByText("Reviewers stay anonymous to you")).toBeVisible();
});

test("a mention in another reviewer's note opens from the bell on the note in the Comments tab", async ({
  page,
}) => {
  await page.goto("/?as=DH");
  await page.getByRole("button", { name: /^Notifications/ }).click();
  const panel = page.getByRole("dialog", { name: "Notifications" });
  await panel
    .getByTestId("notification")
    .filter({ hasText: "Simona Marková mentioned you in a note" })
    .getByRole("button", { name: "Open the note" })
    .click();
  await expect(page).toHaveURL(
    /\/slides\/[0-9a-f-]+\?task=[0-9a-f-]+&object=T5&tab=comments&as=DH$/,
  );
  const notes = page.getByRole("region", { name: "Decision notes on T5" });
  await expect(notes).toContainText("Note on decision: Disagree");
  await expect(notes).toContainText("Runs past the fold, @Daniel Hruška worth a look");
  await expect(notes.getByRole("button", { name: "Edit" })).toHaveCount(0);
});
