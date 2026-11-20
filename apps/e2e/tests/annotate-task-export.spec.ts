import { statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { expect, test } from "./harness.ts";
import { call, idOf, root, sql } from "./support.ts";

const fixture = `${root}packages/test-fixtures/synthetic/synthetic-jpeg.tiff`;

const polygon = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: {},
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [200, 150],
            [420, 170],
            [380, 360],
            [200, 150],
          ],
        ],
      },
    },
  ],
};

test("an annotate task exports its objects as Parfocal JSON and the file imports again", async ({
  page,
  researcher,
}) => {
  test.setTimeout(120_000);
  const sample = await call(page, "POST", "/api/projects/sample");
  expect(sample.status, JSON.stringify(sample.json)).toBe(201);
  const projectId = idOf(sample);

  await page.goto(`/projects/${projectId}/tasks/new-annotate?step=slides`);
  const flow = page.getByTestId("new-annotate-task");
  await flow.getByRole("checkbox").first().check();
  await flow.getByRole("button", { name: "Next" }).click();
  await flow.getByRole("checkbox").first().check();
  for (let step = 0; step < 3; step += 1) {
    await flow.getByRole("button", { name: "Next" }).click();
  }
  await flow.getByRole("textbox", { name: "Task name" }).fill("Export the sample");
  await flow.getByRole("button", { name: "Send to experts" }).click();
  await expect(flow.getByRole("status")).toContainText("Export the sample was sent");
  await flow.getByRole("button", { name: "Open the task" }).click();
  await expect(page).toHaveURL(/\/slides\/[^/?]+\?task=[^&]+&mode=annotate/);
  const taskId = new URL(page.url()).searchParams.get("task") ?? "";
  expect(taskId).not.toBe("");

  const task = await call(page, "GET", `/api/review-tasks/${taskId}`);
  const slides = (task.json as { slides: { slide_id: string }[] }).slides;
  const slideId = slides[0]?.slide_id ?? "";
  expect(slideId).not.toBe("");
  sql(
    `UPDATE slides SET original_key = 'e2e/' || id || '/slide.tiff', ` +
      `file_bytes = ${statSync(fixture).size} WHERE id = '${slideId}' ` +
      `AND tenant_id = '${researcher.tenantId}' RETURNING id`,
  );

  const layer = `/api/review-tasks/${taskId}/slides/${slideId}/shared-layer`;
  const seeded = await call(page, "POST", `${layer}/imports`, {
    file_name: "seed.geojson",
    content: polygon,
  });
  expect(seeded.status, JSON.stringify(seeded.json)).toBe(201);

  await page.goto(`/projects/${projectId}/slides/${slideId}/live?task=${taskId}`);
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
    timeout: 20_000,
  });
  await page.getByTestId("export-menu").click();
  const download = page.waitForEvent("download");
  await page.getByTestId("export-parfocal").click();
  const file = await download;
  const path = await file.path();
  const exported = JSON.parse(await readFile(path, "utf8")) as {
    format: string;
    objects: unknown[];
  };
  expect(exported.format).toBe("parfocal-results");
  expect(exported.objects.length).toBeGreaterThanOrEqual(1);

  const again = await call(page, "POST", `${layer}/imports`, {
    file_name: file.suggestedFilename(),
    content: exported,
  });
  expect(again.status, JSON.stringify(again.json)).toBe(201);
  const result = again.json as { objects: unknown[]; skipped: unknown[] };
  expect(result.objects.length).toBe(exported.objects.length);
  expect(result.skipped).toEqual([]);
});
