import { expect, type Page, test } from "@playwright/test";

const story = (name: string) =>
  `/iframe.html?id=components-review-popovers--${name}&viewMode=story&globals=a11y.manual:!true`;

const ringButton = (page: Page) => page.getByRole("banner").getByRole("button", { name: /% done/ });

async function openPopover(page: Page) {
  await ringButton(page).click();
  return page.getByRole("dialog", { name: "Review progress" });
}

test("an empty slide shows an open ring at 0% and a popover that starts the task", async ({
  page,
}) => {
  await page.goto(story("top-bar-ring-empty"));
  const ring = ringButton(page).getByRole("img", {
    name: "0% done: 0 agree, 0 disagree, 0 not sure, 12 open",
  });
  await expect(ring).toContainText("0%");
  await expect(ring.locator("[data-decision]")).toHaveCount(1);
  await expect(ring.locator("[data-decision=open]")).toHaveCount(1);
  const popover = await openPopover(page);
  await expect(popover).toContainText("Task RT-14");
  await expect(popover).toContainText("0 of 12");
  await expect(popover).toContainText("Slide 1 of 12");
  await expect(popover.getByRole("button", { name: /Previous slide/ })).toBeDisabled();
});

test("a partial slide splits the ring by decision colour and the popover opens the next slide", async ({
  page,
}) => {
  await page.goto(story("top-bar-ring-partial"));
  const ring = ringButton(page).getByRole("img", {
    name: "67% done: 5 agree, 2 disagree, 1 not sure, 4 open",
  });
  await expect(ring).toContainText("67%");
  for (const decision of ["agree", "disagree", "unsure", "open"]) {
    await expect(ring.locator(`[data-decision=${decision}]`)).toHaveCount(1);
  }
  const popover = await openPopover(page);
  await expect(popover).toContainText("RT-14");
  await expect(popover).toContainText("Round 2 · CAMELYON v1.0");
  await expect(popover).toContainText("Slide 8 of 12");
  await expect(popover).toContainText("Fri 23 Oct");
  await expect(popover).toContainText("about 1 h 20 min");
  await popover.getByRole("button", { name: /Next slide/ }).click();
  await expect(page.getByRole("status", { name: "Opened slide" })).toHaveText("Slide 9");
  await expect(page.getByRole("banner")).toContainText("Slide 9 of 12");
});

test("a finished slide shows a check instead of a percentage and the last slide has no next", async ({
  page,
}) => {
  await page.goto(story("top-bar-ring-finished"));
  const ring = ringButton(page).getByRole("img", {
    name: "100% done: 7 agree, 3 disagree, 2 not sure, 0 open",
  });
  await expect(ring).not.toContainText("%");
  await expect(ring.locator("[data-decision=open]")).toHaveCount(0);
  await expect(ring.locator("[data-decision]")).toHaveCount(3);
  const popover = await openPopover(page);
  await expect(popover).toContainText("12 of 12");
  await expect(popover).toContainText("Slide 12 of 12");
  await expect(popover.getByRole("button", { name: /Next slide/ })).toBeDisabled();
});
