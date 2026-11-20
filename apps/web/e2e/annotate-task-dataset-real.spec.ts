import { expect, test } from "@playwright/test";
import { area, realTags, signIn, viewableTask } from "./real.ts";

test.use({ viewport: { width: 1440, height: 900 } });

test(
  "an annotate task offers its dataset and patches and explains a refusal",
  realTags(area.annotate),
  async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page, "/my-work");
    const { project, task, slide } = await viewableTask(page, "annotate");
    await page.goto(`/projects/${project}/slides/${slide}?task=${task}&tab=objects`);
    await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
      timeout: 30_000,
    });
    await page.getByTestId("export-menu").click();
    await expect(page.getByTestId("export-training-dataset")).toContainText(
      "Training dataset (QuPath GeoJSON zip)",
    );
    await expect(page.getByTestId("export-patches")).toContainText("Patches with masks");
    await page.getByTestId("export-training-dataset").click();
    await expect(
      page.getByText(/No slide of this task is signed off yet|Saved .*dataset\.zip/),
    ).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("export-menu").click();
    await page.getByTestId("export-patches").click();
    await page.getByRole("button", { name: "Cut the patches" }).click();
    await expect(
      page.getByTestId("patch-export-refusal").or(page.getByTestId("patch-export-job")),
    ).toBeVisible({ timeout: 30_000 });
  },
);
