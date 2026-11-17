import { expect, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const sourceId = "00000000-0000-4000-8098-000000000001";

test("the watched folder is turned off and on from the overlay with one interval shown", async ({
  page,
}) => {
  const watches: { method: string; body: unknown }[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith(`/api/projects/${p07}/watch`)) {
      watches.push({ method: request.method(), body: request.postDataJSON() });
    }
  });
  await page.goto(`/projects/${p07}/upload?scene=api`);
  const modal = page.getByTestId("imports-modal");
  const folder = modal.getByRole("switch", { name: "Watched folder on" });
  await expect(folder).toBeChecked({ timeout: 20_000 });
  await expect(modal.getByText("Looks for new files every 1 hour.")).toBeVisible();
  await expect(modal.getByText("1 hour", { exact: false })).toHaveCount(1);

  await folder.click();
  await expect(folder).not.toBeChecked();
  await expect(folder).toBeDisabled();
  expect(watches).toEqual([{ method: "DELETE", body: null }]);

  await modal.getByRole("combobox", { name: "Source to watch" }).click();
  await page.getByRole("option", { name: "Vltava scanner bucket" }).click();
  await expect(folder).toBeEnabled();
  await folder.click();
  await expect(folder).toBeChecked();
  await expect(
    modal.getByText("Vltava scanner bucket, s3.eu-central-1.amazonaws.com"),
  ).toBeVisible();
  await expect(modal.getByText("1 hour", { exact: false })).toHaveCount(1);
  expect(watches.at(-1)).toEqual({ method: "PUT", body: { source_id: sourceId } });
});
