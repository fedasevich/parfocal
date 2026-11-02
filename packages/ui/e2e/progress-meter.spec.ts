import { expect, test } from "@playwright/test";

const story = (name: string) =>
  `/iframe.html?id=components-feedback-and-surfaces--${name}&viewMode=story&globals=a11y.manual:!true`;

test("each progress bar is a progressbar with its value and its right-hand text", async ({
  page,
}) => {
  await page.goto(story("progress-bars"));
  const upload = page.getByRole("progressbar", { name: "S26-04812_A1_HE.svs" });
  await expect(upload).toHaveAttribute("aria-valuenow", "50");
  await expect(upload).toHaveAttribute("aria-valuemin", "0");
  await expect(upload).toHaveAttribute("aria-valuemax", "100");
  await expect(upload).toHaveAttribute("aria-valuetext", "1.2 of 2.4 GB");
  await expect(page.getByRole("progressbar", { name: "Waiting in the queue" })).toHaveAttribute(
    "aria-valuenow",
    "0",
  );
  await expect(page.getByRole("progressbar", { name: "Report" })).toHaveAttribute(
    "aria-valuenow",
    "100",
  );
});

test("an unknown amount is a progressbar without a value", async ({ page }) => {
  await page.goto(story("progress-bars"));
  const starting = page.getByRole("progressbar", { name: "Reading the file" });
  await expect(starting).not.toHaveAttribute("aria-valuenow", /.+/);
});

test("each ring is an image that says the percentage and the split", async ({ page }) => {
  await page.goto(story("progress-rings"));
  await expect(
    page.getByRole("img", { name: "55% done: 20 agree, 6 disagree, 4 not sure, 25 open" }),
  ).toContainText("55%");
  await expect(
    page.getByRole("img", { name: "0% done: 0 agree, 0 disagree, 0 not sure, 55 open" }),
  ).toContainText("0%");
  await expect(
    page.getByRole("img", { name: "100% done: 38 agree, 11 disagree, 6 not sure, 0 open" }),
  ).toBeVisible();
});

test("the stacked bar is an image with the three counts, or says no answers yet", async ({
  page,
}) => {
  await page.goto(story("stacked-bars"));
  await expect(page.getByRole("img", { name: "No answers yet" })).toBeVisible();
  const filled = page.getByRole("img", { name: "38 agree, 6 not sure, 11 disagree" });
  await expect(filled).toBeVisible();
  await expect(filled.locator("[data-decision]")).toHaveCount(3);
  await expect(
    page.getByRole("img", { name: "7 agree, 0 not sure, 0 disagree" }).locator("[data-decision]"),
  ).toHaveCount(1);
});
