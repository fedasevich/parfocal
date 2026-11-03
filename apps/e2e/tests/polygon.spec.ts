import { statSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { call, field, idOf, researcherWorkspace, root, signIn, sql } from "./support.ts";

const fixture = `${root}packages/test-fixtures/synthetic/synthetic-jpeg.tiff`;

const corners = [
  [200, 150],
  [420, 170],
  [380, 360],
  [220, 330],
] as const;

test("a researcher draws a polygon on a live slide, reloads, and PostGIS holds the same shape", async ({
  page,
}) => {
  await signIn(page, "/");
  const profile = await call(page, "GET", "/api/me");
  const me = field(profile, "user_id");
  const home = Reflect.get(profile.json ?? {}, "active_tenant_id") as unknown;
  const tenantId = researcherWorkspace(me);
  const switched = await call(page, "PUT", "/api/me/workspace", { tenant_id: tenantId });
  expect(switched.status, JSON.stringify(switched.json)).toBe(200);
  const sample = await call(page, "POST", "/api/projects/sample");
  expect(sample.status, JSON.stringify(sample.json)).toBe(201);
  const projectId = idOf(sample);
  const slideId = sql(
    `UPDATE slides SET original_key = 'e2e/' || id || '/slide.tiff', ` +
      `file_bytes = ${statSync(fixture).size} ` +
      `WHERE project_id = '${projectId}' AND label = 'tumor_001' RETURNING id`,
  ).split("\n")[0];

  await page.goto(`/projects/${projectId}/slides/${slideId}/live`);
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 20_000 });
  await expect(stage).toHaveAttribute("data-annotations", "loaded");
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0 };
  await page.keyboard.press("p");
  for (const [x, y] of corners) await page.mouse.click(box.x + x, box.y + y);
  await page.mouse.click(box.x + corners[0][0] + 2, box.y + corners[0][1] + 1);
  await expect(stage).toHaveAttribute("data-save-state", "saved");
  const shape = page.getByTestId("polygon-shape");
  const drawn = await shape.getAttribute("data-vertices");

  await page.reload();
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 20_000 });
  await expect(stage).toHaveAttribute("data-annotations", "loaded");
  await expect(shape).toHaveCount(1);
  await expect(shape).toHaveAttribute("data-points", "4");
  expect(await shape.getAttribute("data-vertices")).toBe(drawn);

  const [kind = "", number = "", type = "", points = "", srid = ""] = sql(
    `SELECT kind || '|' || number || '|' || GeometryType(geometry) || '|' || ST_NPoints(geometry) ` +
      `|| '|' || ST_SRID(geometry) FROM annotations WHERE slide_id = '${slideId}'`,
  ).split("|");
  expect([kind, number, type, points, srid]).toEqual(["region", "1", "POLYGON", "5", "0"]);
  const stored = sql(
    `SELECT string_agg(round(ST_X(point.geom))::int || ' ' || round(ST_Y(point.geom))::int, ' ' ` +
      `ORDER BY point.path) FROM annotations, ST_DumpPoints(ST_ExteriorRing(geometry)) AS point ` +
      `WHERE slide_id = '${slideId}' AND point.path[1] < 5`,
  );
  expect(stored).toBe(drawn);

  if (typeof home === "string") {
    await call(page, "PUT", "/api/me/workspace", { tenant_id: home });
  }
});
