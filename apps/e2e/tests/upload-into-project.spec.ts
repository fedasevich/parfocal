import { execFileSync } from "node:child_process";
import { fixturePath } from "@parfocal/test-fixtures";
import { expect, type Page, test } from "@playwright/test";
import {
  call,
  field,
  idOf,
  type Reply,
  researcherWorkspace,
  root,
  signIn,
  sql,
} from "./support.ts";

const SLIDE = "CMU-1-Small-Region.svs";
const RESULT = "CMU-1-Small-Region.geojson";

function square(x: number, y: number, side: number): number[][][] {
  return [
    [
      [x, y],
      [x + side, y],
      [x + side, y + side],
      [x, y + side],
      [x, y],
    ],
  ];
}

const regions = JSON.stringify({
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "Polygon", coordinates: square(400, 400, 300) },
      properties: { classification: { name: "Tumor" } },
    },
    {
      type: "Feature",
      geometry: { type: "Polygon", coordinates: square(1200, 1600, 250) },
      properties: { classification: { name: "Stroma" } },
    },
  ],
});

function runIngest(tenantId: string): void {
  execFileSync(
    "uv",
    [
      "run",
      "--package",
      "parfocal-ingest",
      "python",
      "-m",
      "parfocal_ingest",
      "--idle-exit",
      "3",
      "--poll",
      "0.2",
      "--workspace",
      tenantId,
    ],
    { cwd: root, stdio: "ignore", timeout: 120_000 },
  );
}

function ensureLocalBucket(): void {
  execFileSync("uv", ["run", "python", "-m", "parfocal_common.local_bucket"], {
    cwd: root,
    stdio: "ignore",
  });
}

async function statusOf(page: Page, uploadId: string): Promise<Reply> {
  const reply = await call(page, "GET", `/api/uploads/${uploadId}/status`);
  expect(reply.status, JSON.stringify(reply.json)).toBe(200);
  return reply;
}

async function uploadResult(
  page: Page,
  projectId: string,
  slideUploadId: string,
  bytes: Buffer,
): Promise<string> {
  const created = await call(page, "POST", "/api/uploads/s3/multipart", {
    filename: RESULT,
    type: "application/geo+json",
    metadata: {
      project_id: projectId,
      size: bytes.length,
      kind: "result",
      slide_upload_id: slideUploadId,
      pairing_rule: "file-name",
      pairing_certainty: "sure",
    },
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
  return uploadId;
}

test.beforeAll(ensureLocalBucket);

test("an SVS and its GeoJSON result upload into a project and both show there", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await signIn(page, "/");
  const profile = await call(page, "GET", "/api/me");
  const me = field(profile, "user_id");
  const home = Reflect.get(profile.json ?? {}, "active_tenant_id") as unknown;
  const tenantId = researcherWorkspace(me);
  const switched = await call(page, "PUT", "/api/me/workspace", { tenant_id: tenantId });
  expect(switched.status, JSON.stringify(switched.json)).toBe(200);

  const project = await call(page, "POST", "/api/projects", { name: "Skeleton upload" });
  expect(project.status, JSON.stringify(project.json)).toBe(201);
  const projectId = idOf(project);
  const created = await call(page, "POST", "/api/cases", { project_id: projectId, label: "SK-1" });
  expect(created.status, JSON.stringify(created.json)).toBe(201);
  const caseId = idOf(created);

  await page.goto(`/projects/${projectId}/cases/${caseId}/upload`);
  await expect(page.getByTestId("upload-drawer")).toBeVisible();
  await page.getByTestId("file-input").setInputFiles(fixturePath(SLIDE));
  await expect(page.getByTestId("upload-row")).toHaveAttribute("data-status", "done", {
    timeout: 60_000,
  });
  const slideUploadId = sql(
    `SELECT id FROM uploads WHERE project_id = '${projectId}' AND file_name = '${SLIDE}'`,
  );
  expect(slideUploadId).not.toBe("");

  const resultUploadId = await uploadResult(
    page,
    projectId,
    slideUploadId,
    Buffer.from(regions, "utf8"),
  );
  expect(sql(`SELECT count(*) FROM uploads WHERE project_id = '${projectId}'`)).toBe("2");
  expect(
    sql(
      `SELECT count(*) FROM uploads WHERE project_id = '${projectId}' ` +
        `AND status = 'completed' AND object_key LIKE 't/${tenantId}/%'`,
    ),
  ).toBe("2");

  runIngest(tenantId);
  const slideState = await statusOf(page, slideUploadId);
  expect(slideState.json).toMatchObject({ status: "ready" });
  const slideId = field(slideState, "slide_id");
  const waiting = await statusOf(page, resultUploadId);
  expect(waiting.json).toMatchObject({ slide_id: slideId });
  if (Reflect.get(waiting.json ?? {}, "reason") === "needs-choices") {
    const chosen = await call(page, "PUT", `/api/uploads/${resultUploadId}/import-choices`, {});
    expect(chosen.status, JSON.stringify(chosen.json)).toBe(200);
    runIngest(tenantId);
  }
  const resultState = await statusOf(page, resultUploadId);
  expect(resultState.json).toMatchObject({ status: "ready", slide_id: slideId });
  const resultSetId = field(resultState, "result_set_id");

  expect(
    sql(
      `SELECT s.case_id || '|' || r.slide_id || '|' || r.status || '|' || r.region_count ` +
        `FROM result_sets r JOIN slides s ON s.id = r.slide_id WHERE r.id = '${resultSetId}'`,
    ),
  ).toBe(`${caseId}|${slideId}|ready|2`);
  expect(
    sql(
      `SELECT count(*) FROM slides WHERE project_id = '${projectId}' AND tenant_id = '${tenantId}'`,
    ),
  ).toBe("1");

  await page.goto(`/projects/${projectId}?tab=slides`);
  const row = page.getByTestId("slide-row");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("CMU-1-Small-Region");
  await expect(row.getByTitle(/GeoJSON import/)).toHaveText("GeoJSON");
  await row.getByTitle(/GeoJSON import/).click();
  await expect(page.getByTestId("result-sets")).toContainText("GeoJSON import");
  await expect(page.getByTestId("result-sets")).toContainText(`Imported from ${RESULT}`);
  await expect(page.getByTestId("result-sets")).toContainText("2 regions");

  if (typeof home === "string") {
    await call(page, "PUT", "/api/me/workspace", { tenant_id: home });
  }
});
