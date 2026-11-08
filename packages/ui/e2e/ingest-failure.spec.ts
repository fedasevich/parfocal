import { expect, test } from "@playwright/test";

const story = (name: string) =>
  `/iframe.html?id=components-ingest-failures--${name}&viewMode=story&globals=a11y.manual:!true`;

const transient = [
  { story: "check-stopped", file: "tumor_044.svs", message: "stopped before it finished" },
  { story: "size-mismatch", file: "tumor_052.ndpi", message: "parts are missing" },
  { story: "truncated", file: "cut-short.tiff", message: "The file is cut short" },
];

const permanent = [
  { story: "unsupported-format", file: "tumor_060.czi", message: "Export the slide as OME-TIFF" },
  { story: "unreadable-slide", file: "tumor_071.svs", message: "cannot read the pixels" },
  { story: "result-file", file: "lab_model_v3.geojson", message: "lies outside its slide" },
];

for (const failure of transient) {
  test(`the ${failure.story} failure says what happened and offers a retry`, async ({ page }) => {
    await page.goto(story(failure.story));
    const alert = page.getByRole("alert");
    await expect(alert).toHaveAttribute("data-failure-class", "transient");
    await expect(alert).toContainText(`${failure.file} did not finish`);
    await expect(alert).toContainText(failure.message);
    await expect(alert.getByRole("link")).toHaveCount(0);
    await alert.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByText("Retry pressed")).toBeVisible();
  });
}

for (const failure of permanent) {
  test(`the ${failure.story} failure says why and points to support, not a retry`, async ({
    page,
  }) => {
    await page.goto(story(failure.story));
    const alert = page.getByRole("alert");
    await expect(alert).toHaveAttribute("data-failure-class", "permanent");
    await expect(alert).toContainText(`${failure.file} was refused`);
    await expect(alert).toContainText(failure.message);
    await expect(alert.getByRole("button")).toHaveCount(0);
    await expect(alert.getByRole("link", { name: "Contact support" })).toHaveAttribute(
      "href",
      /^mailto:support@parfocal\.eu\?subject=Refused%20upload%20/,
    );
  });
}

test("a permanent failure without a support address shows no dead link", async ({ page }) => {
  await page.goto(story("permanent-without-support-address"));
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("notes.svs was refused");
  await expect(alert.getByRole("link")).toHaveCount(0);
  await expect(alert.getByRole("button")).toHaveCount(0);
});

test("a skipped duplicate shows a neutral status, not a failure", async ({ page }) => {
  await page.goto(story("skipped-duplicate"));
  const status = page.locator("[data-slot=ingest-skipped]");
  await expect(status).toHaveAttribute("role", "status");
  await expect(status).toContainText("renamed-copy.svs Skipped, already in this project.");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(status.getByRole("button")).toHaveCount(0);
});
