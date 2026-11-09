import { expect, type Page, test } from "./a11y.ts";

async function fullViewerUrl(page: Page) {
  await page.goto("/prototype");
  const link = page
    .getByRole("list", { name: "Screens" })
    .getByRole("link", { name: "Full viewer · Objects tab", exact: true });
  return (await link.getAttribute("href")) ?? "";
}

test("every control in the slide top bar is reachable and works from the keyboard", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto(await fullViewerUrl(page));
  const bar = page.locator('[data-slot="review-top-bar"]');
  await expect(bar.getByRole("link", { name: /Back to My work/ })).toBeVisible();
  await expect(bar.getByRole("radio", { name: "Guided" })).toBeVisible();
  await expect(bar.getByRole("radio", { name: "Full viewer" })).toBeVisible();
  await expect(bar.getByRole("radio", { name: "Annotate" })).toBeVisible();

  const picker = bar.getByRole("button", { name: /^A1/ }).first();
  await picker.focus();
  await page.keyboard.press("Enter");
  const slides = page.getByRole("dialog", { name: "Slides in this case and task" });
  await expect(slides).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(slides).toBeHidden();

  const ring = bar.getByRole("button", { name: /% done/ });
  await ring.focus();
  await page.keyboard.press("Enter");
  const progress = page.getByRole("dialog", { name: "Review progress" });
  await expect(progress).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(progress).toBeHidden();

  const panel = bar.getByRole("button", { name: "Side panel" });
  await expect(panel).toHaveAttribute("aria-pressed", "true");
  await panel.focus();
  await page.keyboard.press("Enter");
  await expect(panel).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("Enter");
  await expect(panel).toHaveAttribute("aria-pressed", "true");

  const more = bar.getByRole("button", { name: "More" });
  await more.focus();
  await page.keyboard.press("Enter");
  for (const name of [
    /Share this view/,
    /Add a result set/,
    /Run a model/,
    /Compare with another slide/,
    /Focus mode/,
    /Keyboard shortcuts/,
    /Settings/,
  ]) {
    await expect(page.getByRole("menuitem", { name })).toBeVisible();
  }
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menuitem", { name: /Settings/ })).toBeHidden();

  await expect(bar.getByRole("button", { name: /Submit|Review/ }).last()).toBeVisible();
});

test("the popovers also close on an outside click", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto(await fullViewerUrl(page));
  await page.getByRole("button", { name: /% done/ }).click();
  const progress = page.getByRole("dialog", { name: "Review progress" });
  await expect(progress).toBeVisible();
  await page.locator('[data-slot="review-top-bar"] b').first().click();
  await expect(progress).toBeHidden();
});
