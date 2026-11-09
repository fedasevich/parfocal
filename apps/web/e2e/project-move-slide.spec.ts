import { expect, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";

const reason = "Filed under the wrong accession";

test("a loose slide is filed, a filed slide is moved with a reason, and a signed-off task refuses", async ({
  page,
}) => {
  const moves: Record<string, unknown>[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && /\/api\/slides\/[^/]+\/move$/.test(request.url()))
      moves.push(request.postDataJSON() as Record<string, unknown>);
  });
  await page.goto(`/projects/${p07}?tab=slides&as=DH`);
  const loose = page.getByTestId("slide-row").filter({ hasText: "tumor_031" });
  await loose.getByRole("button", { name: "File into a case" }).click();
  const dialog = page.getByRole("dialog", { name: "File into a case" });
  await dialog.getByRole("button", { name: "File slide" }).click();
  await expect(dialog).toContainText("Pick the case.");
  await expect(dialog).toContainText("Give a reason of at least 10 characters.");
  await dialog.getByRole("combobox").selectOption({ label: "S26-04769" });
  await dialog.getByRole("textbox").fill(reason);
  await dialog.getByRole("button", { name: "File slide" }).click();
  await expect(dialog).toHaveCount(0);
  expect(moves).toHaveLength(1);
  expect(moves[0]).toMatchObject({ reason });
  await expect(page.getByTestId("slide-row").filter({ hasText: "tumor_031" })).toHaveCount(0);
  await page.getByRole("button", { name: /Case S26-04769/ }).click();
  const filed = page.getByTestId("slide-row").filter({ hasText: "tumor_031" });
  await expect(filed).toBeVisible();

  await filed.getByRole("button", { name: "Move to another case" }).click();
  const moveDialog = page.getByRole("dialog", { name: "Move to another case" });
  await expect(moveDialog.getByRole("combobox")).not.toContainText("S26-04769");
  await moveDialog.getByRole("combobox").selectOption({ label: "S26-04777" });
  await moveDialog.getByRole("textbox").fill("Belongs with the right axilla");
  await moveDialog.getByRole("button", { name: "Move slide" }).click();
  await expect(moveDialog).toHaveCount(0);
  expect(moves).toHaveLength(2);

  const held = page.getByTestId("slide-row").filter({ hasText: "S26-04812_A1" });
  await held.getByRole("button", { name: "Move to another case" }).click();
  const refused = page.getByRole("dialog", { name: "Move to another case" });
  await refused.getByRole("combobox").selectOption({ label: "S26-04769" });
  await refused.getByRole("textbox").fill(reason);
  await refused.getByRole("button", { name: "Move slide" }).click();
  await expect(refused.getByRole("alert")).toContainText("signed off");
  await expect(refused).toBeVisible();
  expect(moves).toHaveLength(3);
});
