import { expect, test } from "@playwright/test";

const p07 = "00000000-0000-4000-8003-000000000007";

test("an owner edits and reorders the slides of a case through the fake API", async ({ page }) => {
  const sent: { method: string; body: unknown }[] = [];
  page.on("request", (request) => {
    if (/\/api\/(slides\/[^/]+|cases\/[^/]+\/slide-order)$/.test(request.url())) {
      sent.push({ method: request.method(), body: request.postDataJSON() });
    }
  });

  await page.goto(`/projects/${p07}?tab=slides&as=DH`);
  await page.getByRole("button", { name: "Edit slides" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Edit slides" });
  await expect(dialog.getByTestId("slide-edit-row")).toHaveCount(3);
  await expect(dialog.getByLabel("Label of slide 1")).toHaveValue("A1");

  await dialog.getByLabel("Stain of slide 1").fill("PAS");
  await dialog.getByLabel("Level of slide 1").fill("2");
  await dialog.getByRole("button", { name: "Move A3 up" }).click();
  await expect(dialog.getByLabel("Label of slide 2")).toHaveValue("A3");

  await dialog.getByLabel("Label of slide 1").fill("A2");
  await dialog.getByRole("button", { name: "Save slides" }).click();
  await expect(dialog).toContainText("Another slide is already labelled A2.");
  expect(sent).toEqual([]);

  await dialog.getByLabel("Label of slide 1").fill("A1-b");
  await dialog.getByRole("button", { name: "Save slides" }).click();
  await expect(dialog).toBeHidden();
  expect(sent[0]).toEqual({ method: "PATCH", body: { label: "A1-b", stain: "PAS", level: 2 } });
  expect(sent[1]).toEqual({
    method: "PUT",
    body: { slide_ids: [expect.any(String), expect.any(String), expect.any(String)] },
  });

  await page.getByRole("button", { name: "Edit slides" }).first().click();
  const again = page.getByRole("dialog", { name: "Edit slides" });
  await expect(again.getByLabel("Label of slide 1")).toHaveValue("A1-b");
  await expect(again.getByLabel("Stain of slide 1")).toHaveValue("PAS");
  await expect(again.getByLabel("Label of slide 2")).toHaveValue("A3");
});

test("a project reviewer gets no slide editing", async ({ page }) => {
  await page.goto(`/projects/${p07}?tab=slides&as=LM`);
  await expect(page.getByText("Case S26-04812")).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit slides" })).toHaveCount(0);
});
