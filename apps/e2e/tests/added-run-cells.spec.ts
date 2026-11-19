import type { Page } from "@playwright/test";
import { expect, test } from "./harness.ts";
import { call, field, idOf, type Reply, sql } from "./support.ts";

const RESULT = "added-run-cells.geojson";

interface AiObject {
  object: string;
  kind: string;
  geometry: unknown;
}

interface Counts {
  confirmed: number;
  edited: number;
  deleted: number;
}

function cell(x: number, y: number) {
  const side = 12;
  return {
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [x, y],
          [x + side, y],
          [x + side, y + side],
          [x, y + side],
          [x, y],
        ],
      ],
    },
    properties: { objectType: "cell", classification: { name: "Tumor" } },
  };
}

const cells = JSON.stringify({
  type: "FeatureCollection",
  features: Array.from({ length: 8 }, (_, index) => cell(200 + index * 40, 300)),
});

async function uploadCells(page: Page, projectId: string, slideId: string): Promise<string> {
  const bytes = Buffer.from(cells, "utf8");
  const created = await call(page, "POST", "/api/uploads/s3/multipart", {
    filename: RESULT,
    type: "application/geo+json",
    metadata: { project_id: projectId, size: bytes.length, kind: "result", slide_id: slideId },
  });
  expect(created.status, JSON.stringify(created.json)).toBe(201);
  const uploadId = field(created, "uploadId");
  const key = encodeURIComponent(field(created, "key"));
  const base = `/api/uploads/s3/multipart/${uploadId}`;
  const signed = await call(page, "GET", `${base}/1?key=${key}`);
  expect(signed.status, JSON.stringify(signed.json)).toBe(200);
  const stored = await page.request.put(field(signed, "url"), { data: bytes });
  expect(stored.status()).toBe(200);
  const etag = (stored.headers()["etag"] ?? "").replaceAll('"', "");
  const done = await call(page, "POST", `${base}/complete?key=${key}`, {
    parts: [{ PartNumber: 1, ETag: etag }],
  });
  expect(done.status, JSON.stringify(done.json)).toBe(200);
  let latest: Reply = { status: 0, json: null };
  await expect
    .poll(
      async () => {
        latest = await call(page, "GET", `/api/uploads/${uploadId}/status`);
        const status = String(Reflect.get(latest.json ?? {}, "status"));
        if (Reflect.get(latest.json ?? {}, "reason") === "needs-choices")
          await call(page, "PUT", `/api/uploads/${uploadId}/import-choices`, {});
        return status;
      },
      { timeout: 120_000, intervals: [500, 1_000] },
    )
    .toBe("ready");
  return field(latest, "result_set_id");
}

async function counts(page: Page, slide: string): Promise<Counts> {
  const status = await call(page, "GET", `${slide}/check-status`);
  expect(status.status, JSON.stringify(status.json)).toBe(200);
  const found = Reflect.get(status.json ?? {}, "check_progress") as Counts;
  return { confirmed: found.confirmed, edited: found.edited, deleted: found.deleted };
}

test("the cells of a run added to an annotate task are confirmed, deleted and undone", async ({
  page,
  researcher,
}) => {
  test.setTimeout(240_000);
  const sample = await call(page, "POST", "/api/projects/sample");
  expect(sample.status, JSON.stringify(sample.json)).toBe(201);
  const projectId = idOf(sample);
  const slideId = sql(
    `SELECT id FROM slides WHERE project_id = '${projectId}' AND label = 'test_065'`,
  );
  const setId = await uploadCells(page, projectId, slideId);

  const made = await call(page, "POST", `/api/projects/${projectId}/review-tasks`, {
    name: "Fix the added run",
    kind: "annotate",
    slide_ids: [slideId],
    result_sets: [],
    reviewer_ids: [researcher.me],
    split: "everyone",
    preset: "check-whole-slide-run",
  });
  expect(made.status, JSON.stringify(made.json)).toBe(201);
  const slide = `/api/review-tasks/${idOf(made)}/slides/${slideId}`;
  const added = await call(page, "POST", `${slide}/runs`, { result_set_id: setId });
  expect(added.status, JSON.stringify(added.json)).toBe(200);
  expect(added.json).toMatchObject({ result_set_id: setId });

  const listed = await call(page, "GET", `${slide}/shared-layer/ai`);
  expect(listed.status, JSON.stringify(listed.json)).toBe(200);
  const objects = (Reflect.get(listed.json ?? {}, "objects") as AiObject[]).filter(
    (item) => item.kind === "cell",
  );
  expect(objects.length).toBe(8);
  const [first, second] = objects;
  if (first === undefined || second === undefined) throw new Error("The run has no cells");

  const confirmed = await call(page, "POST", `${slide}/shared-layer/ai/${first.object}/confirm`, {
    geometry: first.geometry,
  });
  expect(confirmed.status, JSON.stringify(confirmed.json)).toBe(201);
  expect(await counts(page, slide)).toEqual({ confirmed: 1, edited: 0, deleted: 0 });

  const deleted = await call(page, "POST", `${slide}/shared-layer/ai-changes`, {
    changes: [{ object: second.object, deleted: true, geometry: second.geometry }],
  });
  expect(deleted.status, JSON.stringify(deleted.json)).toBe(200);
  expect(await counts(page, slide)).toEqual({ confirmed: 1, edited: 0, deleted: 1 });
  const copy = (Reflect.get(deleted.json ?? {}, "objects") as { version: number }[])[0];

  const undone = await call(page, "POST", `${slide}/shared-layer/ai-changes`, {
    changes: [{ object: second.object, version: copy?.version, geometry: second.geometry }],
  });
  expect(undone.status, JSON.stringify(undone.json)).toBe(200);
  expect(await counts(page, slide)).toEqual({ confirmed: 1, edited: 1, deleted: 0 });

  const unconfirmed = await call(
    page,
    "DELETE",
    `${slide}/shared-layer/ai/${first.object}/confirm?version=${String(Reflect.get(confirmed.json ?? {}, "version"))}`,
  );
  expect(unconfirmed.status, JSON.stringify(unconfirmed.json)).toBe(204);
  expect(await counts(page, slide)).toEqual({ confirmed: 0, edited: 1, deleted: 0 });

  await page.goto(`/projects/${projectId}/slides/${slideId}/annotate-task?task=${idOf(made)}`);
  await expect(page.getByText("1 edited").first()).toBeVisible({ timeout: 30_000 });
});
