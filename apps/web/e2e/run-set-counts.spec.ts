import { expect, test } from "./telemetry-capture.ts";

const a1 = "00000000-0000-4000-8005-000000000001";
const p07 = "00000000-0000-4000-8003-000000000007";

const runSet = (id: string, name: string, fields: Record<string, unknown>) => ({
  id,
  project_id: p07,
  slide_id: a1,
  name,
  model_version: "v1.2",
  source: "run",
  source_file: null,
  produced_at: null,
  status: "ready",
  error_code: null,
  cell_count: 0,
  region_count: 0,
  zone_count: 0,
  created_by_user_id: null,
  created_at: "2026-11-25T16:09:44+01:00",
  ...fields,
});

test("a run's row counts cells for a nuclei model and says why an empty or failed run has none", async ({
  page,
}) => {
  const sets = [
    runSet("00000000-0000-4000-8009-0000000000d1", "Nuclei with cells", { cell_count: 2428 }),
    runSet("00000000-0000-4000-8009-0000000000d2", "Nuclei on glass", {
      error_code: "run-found-no-tissue",
    }),
    runSet("00000000-0000-4000-8009-0000000000d3", "Nuclei on bare tissue", {
      error_code: "run-found-nothing",
    }),
    runSet("00000000-0000-4000-8009-0000000000d4", "Nuclei not stored", {
      status: "failed",
      error_code: "run-objects-lost",
    }),
  ];
  await page.addInitScript((given) => {
    (window as unknown as { __parfocalFake: unknown }).__parfocalFake = {
      statuses: Object.fromEntries(
        given.map((set) => [
          `up-${set.id}`,
          { kind: "result", status: "ready", slide_id: set.slide_id, result_set_id: set.id },
        ]),
      ),
      chosen: [],
      left: [],
      sets: given,
    };
  }, sets);
  await page.goto(`/projects/${p07}`);
  await page
    .locator('button[aria-expanded="false"][title$="the result sets of this slide"]')
    .first()
    .click();
  const list = page.getByTestId("result-sets");
  const counts = (name: string) =>
    list.locator("div", { hasText: name }).last().getByTestId("result-set-counts");

  await expect(counts("Nuclei with cells")).toHaveText("2,428 cells");
  await expect(counts("Nuclei on glass")).toHaveText("Empty, the run found no tissue on the slide");
  await expect(counts("Nuclei on bare tissue")).toHaveText("Empty, the model found nothing");
  await expect(counts("Nuclei not stored")).toHaveText(
    "Failed, the model found objects but none were stored",
  );
  await expect(list.getByText("0 regions")).toHaveCount(0);
});
