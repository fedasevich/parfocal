import { expect, test } from "./a11y.ts";

test.use({ viewport: { width: 1440, height: 900 } });

test("the annotate stepper ticks nothing, asks for a name and sends the task", async ({ page }) => {
  await page.goto("/prototype");
  const href = await page
    .getByRole("list", { name: "Screens" })
    .getByRole("link", { name: "New annotate task · Kind and presets" })
    .getAttribute("href");
  await page.goto(href ?? "");
  const flow = page.getByTestId("new-annotate-task");
  await expect(flow).toBeVisible();

  await flow.getByRole("button", { name: "Next" }).click();
  const slides = flow.getByRole("checkbox");
  await expect(slides.first()).toBeVisible();
  expect(await slides.count()).toBeGreaterThan(0);
  await expect(flow.locator("input[type=checkbox]:checked")).toHaveCount(0);

  await flow.getByRole("button", { name: "Next" }).click();
  await expect(flow.getByRole("checkbox").first()).toBeVisible();
  await expect(flow.locator("input[type=checkbox]:checked")).toHaveCount(0);

  await flow.getByRole("button", { name: "Next" }).click();
  await flow.getByRole("button", { name: "Next" }).click();
  await flow.getByRole("button", { name: "Next" }).click();
  await expect(flow).toHaveAttribute("data-step", "send");
  await expect(flow.getByRole("button", { name: "Send to experts" })).toBeDisabled();
  await expect(flow.getByText("Name the task")).toBeVisible();
  await expect(flow.getByText("Pick at least one slide")).toBeVisible();
  await expect(flow.getByText("Pick at least one expert")).toBeVisible();

  await flow.getByRole("button", { name: "Slides", exact: true }).first().click();
  await flow.getByRole("checkbox").first().check();
  await flow
    .getByRole("button", { name: /^Experts/ })
    .first()
    .click();
  await flow.getByRole("checkbox").first().check();
  await flow.getByRole("button", { name: /^Send/ }).first().click();
  await expect(flow.getByText("Pick at least one slide")).toHaveCount(0);
  await expect(flow.getByText("Pick at least one expert")).toHaveCount(0);
  await expect(flow.getByRole("button", { name: "Send to experts" })).toBeDisabled();

  await flow.getByRole("textbox", { name: "Task name" }).fill("Round 3 annotate");
  await flow.getByRole("button", { name: "Send to experts" }).click();
  await expect(flow.getByRole("status")).toContainText("Round 3 annotate was sent to 1 expert");

  await flow.getByRole("button", { name: "Open the task" }).click();
  await expect(page).toHaveURL(/\/slides\/[^/?]+\?task=.*mode=annotate/);
});
