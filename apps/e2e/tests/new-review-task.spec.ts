import { expect, test } from "./harness.ts";
import { call, idOf, sql } from "./support.ts";

test("a new task whose scope reads cells gets its review order and one object is reviewed", async ({
  page,
  researcher,
}) => {
  const sample = await call(page, "POST", "/api/projects/sample");
  expect(sample.status, JSON.stringify(sample.json)).toBe(201);
  const projectId = idOf(sample);
  const [slideId = "", setId = ""] = sql(
    `SELECT s.id || '|' || r.id FROM slides s JOIN result_sets r ON r.slide_id = s.id ` +
      `WHERE s.project_id = '${projectId}' AND s.label = 'test_065'`,
  ).split("|");

  const made = await call(page, "POST", `/api/projects/${projectId}/review-tasks`, {
    name: "Cells and regions",
    slide_ids: [slideId],
    result_sets: [{ slide_id: slideId, result_set_id: setId }],
    reviewer_ids: [researcher.me],
    split: "everyone",
    scope: { kind: "random-cells", count: 5 },
    extra_scopes: [{ kind: "all-regions" }],
  });
  expect(made.status, JSON.stringify(made.json)).toBe(201);
  const slide = `/api/review-tasks/${idOf(made)}/slides/${slideId}`;

  await expect
    .poll(async () => (await call(page, "GET", `${slide}/objects`)).status, {
      timeout: 60_000,
      intervals: [1_000],
    })
    .toBe(200);
  const listed = await call(page, "GET", `${slide}/objects`);
  const objects = Reflect.get(listed.json ?? {}, "objects") as { object: string }[];
  const first = objects[0]?.object ?? "";
  expect(first, "the order holds at least one object").not.toBe("");

  const decided = await call(page, "PUT", `${slide}/decisions/${first}`, { answer: "5" });
  expect(decided.status, JSON.stringify(decided.json)).toBe(200);
  expect(decided.json).toMatchObject({ object: first, value: "agree" });
});
