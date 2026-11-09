import { expect, test } from "@playwright/test";

test("hiding a Parfocal model dims its row and undo brings it back", async ({ page }) => {
  await page.goto("/admin?section=models");
  const first = page.getByRole("switch", { name: /^Show / }).first();
  await expect(first).toBeChecked();
  await first.click();
  await expect(first).not.toBeChecked();
  await expect(page.getByText(/is hidden from every model list/)).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(first).toBeChecked();
});

test("cancelling a running model run removes it and undo puts it back", async ({ page }) => {
  await page.goto("/admin?section=models");
  const cancels = page.getByRole("button", { name: /^Cancel .* run$/ });
  await expect(cancels.first()).toBeVisible();
  const before = await cancels.count();
  await cancels.first().click();
  await expect(cancels).toHaveCount(before - 1);
  await expect(page.getByText(/run cancelled\. Slides already done keep/)).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(cancels).toHaveCount(before);
  const sent = page.waitForRequest(
    (request) => request.method() === "POST" && /model-runs\/.+\/cancel/.test(request.url()),
  );
  await cancels.first().click();
  await expect(cancels).toHaveCount(before - 1);
  await sent;
});
