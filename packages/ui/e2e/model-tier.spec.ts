import { expect, test } from "@playwright/test";

const story = (name: string) =>
  `/iframe.html?id=components-viewer-tools--${name}&viewMode=story&globals=a11y.manual:!true`;

test("pointing at a tier shows its exact model and version", async ({ page }) => {
  await page.goto(story("model-tier-picker"));
  const picker = page.getByRole("dialog", { name: "Choose a model" });
  await expect(picker.getByText("HoVer-Net · MONAI Label · v0.9")).toHaveCount(0);
  await picker.getByRole("radio", { name: /Good/ }).hover();
  await expect(picker.getByText("HoVer-Net · MONAI Label · v0.9")).toBeVisible();
  await picker.getByRole("radio", { name: /Fast/ }).hover();
  await expect(picker.getByText("SlimSAM-77 · ONNX in the browser · v1.0")).toBeVisible();
  await expect(picker.getByText("HoVer-Net · MONAI Label · v0.9")).toHaveCount(0);
});

test("the tier pill names the exact model of the chosen tier", async ({ page }) => {
  await page.goto(story("auto-region-bar"));
  await expect(page.locator("[data-slot=tier-pill]")).toHaveAttribute(
    "title",
    "PathoSAM ViT-B · AIS decoder · v1.2",
  );
});
