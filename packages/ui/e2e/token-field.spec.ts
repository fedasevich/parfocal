import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

const story = (id: string) => `/iframe.html?id=${id}&viewMode=story&globals=a11y.manual:!true`;
const live = story("components-form-controls--token-field-live");
const modalStory = story("components-modals-and-flow-pages--token-field-first");
const reviewers = (page: Page) => page.getByRole("combobox", { name: "Reviewers" });
const chips = (page: Page) => page.getByRole("button", { name: /^Remove / });

test("the list stays shut until the person types, clicks or presses the down arrow", async ({
  page,
}) => {
  await page.goto(live);
  const field = reviewers(page);
  await field.focus();
  await expect(page.getByRole("listbox")).toBeHidden();
  await field.press("ArrowDown");
  await expect(page.getByRole("listbox", { name: "Reviewers matches" })).toBeVisible();
  await field.press("Escape");
  await expect(page.getByRole("listbox")).toBeHidden();
  await field.click();
  await expect(page.getByRole("listbox")).toBeVisible();
  await field.press("Escape");
  await field.pressSequentially("a");
  await expect(page.getByRole("listbox")).toBeVisible();
});

test("typing narrows the list and ignores accents and case", async ({ page }) => {
  await page.goto(live);
  const field = reviewers(page);
  await field.pressSequentially("zzz");
  await expect(page.getByRole("option")).toHaveCount(0);
  await expect(page.getByText("No one called that. Type an email to invite them.")).toBeVisible();
  await field.fill("");
  await field.pressSequentially("MALA");
  await expect(page.getByRole("option")).toHaveCount(1);
  await expect(page.getByRole("option", { name: /Lenka Malá/ })).toBeVisible();
});

test("the arrow keys move through the matches and Enter picks the active one", async ({ page }) => {
  await page.goto(live);
  const field = reviewers(page);
  await field.click();
  const options = page.getByRole("option");
  await expect(options).toHaveCount(4);
  await expect(options.first()).toHaveAttribute("aria-selected", "true");
  await field.press("ArrowDown");
  await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(field).toHaveAttribute(
    "aria-activedescendant",
    (await options.nth(1).getAttribute("id")) ?? "",
  );
  await field.press("ArrowUp");
  await field.press("ArrowUp");
  await expect(options.nth(2)).toHaveAttribute("aria-selected", "true");
  await field.press("ArrowDown");
  await field.press("ArrowDown");
  await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");
  await field.press("Enter");
  await expect(page.getByRole("button", { name: "Remove Simona Marková" })).toBeVisible();
  await expect(chips(page)).toHaveCount(1);
  await expect(field).toBeFocused();
  await expect(field).toHaveValue("");
});

test("a picked person leaves the list, and the cross or Backspace removes the chip", async ({
  page,
}) => {
  await page.goto(live);
  const field = reviewers(page);
  await field.click();
  await page.getByRole("option", { name: /Lenka Malá/ }).click();
  await expect(page.getByRole("button", { name: "Remove Lenka Malá" })).toBeVisible();
  await expect(page.getByRole("option", { name: /Lenka Malá/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Remove Lenka Malá" }).click();
  await expect(chips(page)).toHaveCount(0);
  await field.click();
  await page.getByRole("option", { name: /Anna Kopecká/ }).click();
  await expect(chips(page)).toHaveCount(1);
  await field.press("Backspace");
  await expect(chips(page)).toHaveCount(0);
});

test("an email that matches nobody offers an invite that Enter takes", async ({ page }) => {
  await page.goto(live);
  const field = reviewers(page);
  await field.pressSequentially("eva.novak@fnvltava.cz");
  const invite = page.getByRole("option", { name: /Invite eva\.novak@fnvltava\.cz by email/ });
  await expect(invite).toBeVisible();
  await expect(invite).toHaveAttribute("aria-selected", "true");
  await field.press("Enter");
  await expect(page.getByText("Invited eva.novak@fnvltava.cz")).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove eva.novak@fnvltava.cz" })).toBeVisible();
});

test("a half-typed email offers no invite", async ({ page }) => {
  await page.goto(live);
  await reviewers(page).pressSequentially("eva.novak@");
  await expect(page.getByRole("option", { name: /Invite/ })).toHaveCount(0);
});

test("a person who is away is listed but cannot be picked", async ({ page }) => {
  await page.goto(live);
  const field = reviewers(page);
  await field.pressSequentially("kr");
  const away = page.getByRole("option", { name: /Away until 22 Oct/ });
  await expect(away).toHaveAttribute("aria-disabled", "true");
  await field.press("Enter");
  await away.click({ force: true });
  await expect(chips(page)).toHaveCount(0);
});

test("the open list, the chips and the invite row pass axe", async ({ page }) => {
  for (const name of ["token-field-typing", "token-field-invite", "token-field-picked"]) {
    await page.goto(story(`components-form-controls--${name}`));
    await expect(reviewers(page)).toBeVisible();
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"])
      .analyze();
    expect(results.violations, name).toEqual([]);
  }
});

test("a modal that puts first focus on a token field does not open its list", async ({ page }) => {
  await page.goto(modalStory);
  const field = page.getByRole("combobox", { name: "Reviewer" });
  await expect(field).toBeFocused();
  await expect(page.getByRole("listbox")).toBeHidden();
  await expect(page.getByRole("radio", { name: "Short note" })).toBeVisible();
  await field.pressSequentially("t");
  await expect(page.getByRole("listbox", { name: "Reviewer matches" })).toBeVisible();
});

test("Escape shuts the list first and the modal only on the second press", async ({ page }) => {
  await page.goto(modalStory);
  const field = page.getByRole("combobox", { name: "Reviewer" });
  await field.press("ArrowDown");
  await expect(page.getByRole("listbox")).toBeVisible();
  await field.press("Escape");
  await expect(page.getByRole("listbox")).toBeHidden();
  await expect(page.locator('[data-slot="small-modal"]')).toBeVisible();
  await field.press("Escape");
  await expect(page.locator('[data-slot="small-modal"]')).toBeHidden();
});
