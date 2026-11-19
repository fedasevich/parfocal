import { permissionMatrix } from "../src/screens/admin/permission-matrix.generated.ts";
import { expect, test } from "./a11y.ts";

test("People and roles shows what each role and admin rights may do", async ({ page }) => {
  await page.goto("/admin?section=people");
  await expect(
    page.getByRole("heading", { name: "People and roles", exact: true }).first(),
  ).toBeVisible();
  const table = page.getByRole("table", { name: "What each role may do" });
  await table.scrollIntoViewIfNeeded();
  await expect(table).toBeVisible();
  await expect(table.getByRole("columnheader")).toHaveText([
    "Action",
    "Researcher",
    "Reviewer, reviews and annotates",
    "Added by admin rights",
  ]);
  await expect(table.locator("tbody tr")).toHaveCount(permissionMatrix.length);
  const review = table.getByRole("row", { name: /Give decisions, annotate/ });
  await expect(review.getByRole("cell")).toHaveText([
    "Give decisions, annotate, fix results, comment",
    "Yes",
    "In their tasks",
    "No",
  ]);
  const audit = table.getByRole("row", { name: /^Audit log/ });
  await expect(audit.getByRole("cell")).toHaveText(["Audit log", "No", "No", "Yes"]);
});
