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

test("the picker lists Best, Good and Fast with their descriptions and speed, and marks Best as selected", async ({
  page,
}) => {
  await page.goto(story("model-tier-picker"));
  const picker = page.getByRole("dialog", { name: "Choose a model" });
  await expect(picker.getByText("Model for outlining nuclei").first()).toBeVisible();
  await expect(picker.getByRole("radio")).toHaveCount(3);
  await expect(picker.getByRole("radio", { name: /Best/ })).toHaveAttribute("aria-checked", "true");
  await expect(picker.getByRole("radio", { name: /Good/ })).toHaveAttribute(
    "aria-checked",
    "false",
  );
  await expect(
    picker.getByText("The most accurate outlines. Slowest, runs on the hospital server."),
  ).toBeVisible();
  await expect(picker.getByText("Nearly as accurate, about three times quicker.")).toBeVisible();
  await expect(
    picker.getByText("A quick draft that runs on this computer, also offline."),
  ).toBeVisible();
  await expect(picker.getByText("selected")).toHaveCount(1);
  await expect(picker.getByRole("img", { name: "Speed 1 of 3" })).toHaveCount(1);
  await expect(picker.getByRole("img", { name: "Speed 3 of 3" })).toHaveCount(1);
  await expect(picker.getByText(/Your lab decides which model each tier uses/)).toBeVisible();
});

test("choosing a tier moves the selected mark to it", async ({ page }) => {
  await page.goto(story("model-tier-picker"));
  const picker = page.getByRole("dialog", { name: "Choose a model" });
  await picker.getByRole("radio", { name: /Fast/ }).click();
  await expect(picker.getByRole("radio", { name: /Fast/ })).toHaveAttribute("aria-checked", "true");
  await expect(picker.getByRole("radio", { name: /Best/ })).toHaveAttribute(
    "aria-checked",
    "false",
  );
  await expect(picker.getByText("selected")).toHaveCount(1);
});

test("a tier can be chosen from the keyboard and its model shows on focus", async ({ page }) => {
  await page.goto(story("model-tier-picker"));
  const picker = page.getByRole("dialog", { name: "Choose a model" });
  const good = picker.getByRole("radio", { name: /Good/ });
  await good.focus();
  await expect(picker.getByText("HoVer-Net · MONAI Label · v0.9")).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(good).toHaveAttribute("aria-checked", "true");
});

test("Escape and the close button close the picker", async ({ page }) => {
  await page.goto(story("model-tier-picker-offline"));
  const picker = page.getByRole("dialog", { name: "Choose a model" });
  await picker.getByRole("radio", { name: /Best/ }).focus();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("closed")).toHaveText("closed");
});

test("the close button closes the picker", async ({ page }) => {
  await page.goto(story("model-tier-picker-offline"));
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByTestId("closed")).toHaveText("closed");
});

test("a tier whose server is offline cannot be chosen and says why", async ({ page }) => {
  await page.goto(story("model-tier-picker-offline"));
  const picker = page.getByRole("dialog", { name: "Choose a model" });
  const good = picker.getByRole("radio", { name: /Good/ });
  await expect(good).toHaveAttribute("aria-disabled", "true");
  await expect(picker.getByText(/The server that runs this model is not answering/)).toBeVisible();
  await good.click({ force: true });
  await good.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("picked")).toHaveText("Best");
  await expect(page.locator("[data-slot=tier-pill]")).toContainText("Good (offline)");
});
