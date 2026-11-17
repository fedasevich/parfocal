import { expect, test } from "./telemetry-capture.ts";

const a1 = "00000000-0000-4000-8005-000000000001";
const p07 = "00000000-0000-4000-8003-000000000007";
const emptySetId = "00000000-0000-4000-8009-0000000000c1";

test("an empty result set of a slide is deleted from the project's slide list after a confirm", async ({
  page,
}) => {
  await page.addInitScript(
    ({ id, slide, project }) => {
      (window as unknown as { __parfocalFake: unknown }).__parfocalFake = {
        statuses: {
          "up-empty": { kind: "result", status: "ready", slide_id: slide, result_set_id: id },
        },
        chosen: [],
        left: [],
        sets: [
          {
            id,
            project_id: project,
            slide_id: slide,
            name: "Empty import",
            model_version: null,
            source: "import",
            source_file: "empty.geojson",
            produced_at: null,
            status: "ready",
            error_code: null,
            cell_count: 0,
            region_count: 0,
            zone_count: 0,
            created_by_user_id: null,
            created_at: "2026-11-15T09:00:00+01:00",
          },
        ],
      };
    },
    { id: emptySetId, slide: a1, project: p07 },
  );
  await page.goto(`/projects/${p07}`);
  await page
    .locator('button[aria-expanded="false"][title$="the result sets of this slide"]')
    .first()
    .click();
  const list = page.getByTestId("result-sets");
  const empty = list.locator("div", { hasText: "Empty import" }).last();
  await expect(empty).toBeVisible();

  await list.getByRole("button", { name: "Delete Empty import" }).click();
  const confirm = page.getByRole("dialog", { name: "Delete Empty import?" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(list.getByText("Empty import")).toBeVisible();

  await list.getByRole("button", { name: "Delete Empty import" }).click();
  await page
    .getByRole("dialog", { name: "Delete Empty import?" })
    .getByRole("button", { name: "Delete result set" })
    .click();
  await expect(page.getByRole("dialog", { name: "Delete Empty import?" })).toHaveCount(0);
  await expect(page.getByText("Empty import")).toHaveCount(0);
});
