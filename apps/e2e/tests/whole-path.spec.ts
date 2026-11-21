import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fixturePath } from "@parfocal/test-fixtures";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { expect, type Researcher, test } from "./harness.ts";
import {
  adjudicatorUsername,
  call,
  deleteZitadelUser,
  field,
  idOf,
  type Reply,
  root,
  signIn,
  sql,
  zitadelAdmin,
} from "./support.ts";

test.skip(adjudicatorUsername === "", "The local stack has no adjudicator test user");

const SLIDE = "CMU-1-Small-Region.svs";
const CELLS = `${root}packages/test-fixtures/model-results/cmu-1-small-region-svs/cells.geojson`;
const organisation = process.env["ZITADEL_ORGANIZATION_ID"] ?? "";
const run = process.env["PARFOCAL_E2E_RUN"] ?? "";

type Ring = number[][];

function square(x: number, y: number, side: number): Ring {
  return [
    [x, y],
    [x + side, y],
    [x + side, y + side],
    [x, y + side],
    [x, y],
  ];
}

const selection = { type: "Polygon", coordinates: [square(300, 300, 600)] };

function redrawOf(outline: number[]): { type: "Polygon"; coordinates: Ring[] } {
  const xs = outline.filter((_, index) => index % 2 === 0);
  const ys = outline.filter((_, index) => index % 2 === 1);
  const [left, top] = [Math.min(...xs), Math.min(...ys)];
  const [width, height] = [Math.max(...xs) - left, Math.max(...ys) - top];
  const x = Math.round(left + width * 0.6);
  const y = Math.round(top + height * 0.6);
  return { type: "Polygon", coordinates: [square(x, y, Math.ceil(width + height) + 4)] };
}

interface Question {
  key: string;
  kind: string;
  max?: number;
  options?: string[];
}

interface Outline {
  reviewer: string;
  outline: number[];
}

interface Feature {
  geometry: { coordinates: Ring[] };
  properties: {
    parfocal: {
      id: string;
      origin: string;
      author: string | null;
      changed_by: string | null;
      source: string | null;
    };
  };
}

function fitting(question: Question): unknown {
  if (question.kind === "scale") return question.max;
  if (question.kind === "choice") return question.options?.[0];
  if (question.kind === "yesno") return true;
  return "Fine";
}

async function uploadStatus(page: Page, uploadId: string): Promise<Reply> {
  let latest: Reply = { status: 0, json: null };
  await expect
    .poll(
      async () => {
        latest = await call(page, "GET", `/api/uploads/${uploadId}/status`);
        if (Reflect.get(latest.json ?? {}, "reason") === "needs-choices")
          await call(page, "PUT", `/api/uploads/${uploadId}/import-choices`, {});
        return String(Reflect.get(latest.json ?? {}, "status"));
      },
      { timeout: 180_000, intervals: [500, 1_000] },
    )
    .toMatch(/^(ready|failed|skipped)$/);
  expect(latest.json, JSON.stringify(latest.json)).toMatchObject({ status: "ready" });
  return latest;
}

async function uploadCells(page: Page, projectId: string, slideId: string): Promise<string> {
  const bytes = readFileSync(CELLS);
  const created = await call(page, "POST", "/api/uploads/s3/multipart", {
    filename: "cells.geojson",
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
  return field(await uploadStatus(page, uploadId), "result_set_id");
}

async function newReviewer(): Promise<{ email: string; secret: string; userId: string }> {
  const email = `e2e-path-${run}@parfocal.test`;
  const secret = `${randomBytes(12).toString("base64url")}Aa1!`;
  const created = await zitadelAdmin("/v2/users/human", {
    method: "POST",
    body: JSON.stringify({
      organization: { orgId: organisation },
      username: email,
      profile: { givenName: "Second", familyName: "Reviewer" },
      email: { email, isVerified: true },
      password: { password: secret, changeRequired: false },
    }),
  });
  const body = (await created.json()) as { userId?: string };
  expect(created.ok, JSON.stringify(body)).toBe(true);
  return { email, secret, userId: body.userId ?? "" };
}

async function joined(
  browser: Browser,
  researcher: Researcher,
  projectId: string,
  email: string,
  secret?: string,
): Promise<{ context: BrowserContext; page: Page; me: string }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, "/setup", email, secret);
  const me = field(await call(page, "GET", "/api/me"), "user_id");
  sql(
    `INSERT INTO memberships (tenant_id, user_id, role) ` +
      `VALUES ('${researcher.tenantId}', '${me}', 'researcher')`,
  );
  sql(
    `INSERT INTO project_members (tenant_id, project_id, user_id, role) ` +
      `VALUES ('${researcher.tenantId}', '${projectId}', '${me}', 'reviewer')`,
  );
  const switched = await call(page, "PUT", "/api/me/workspace", {
    tenant_id: researcher.tenantId,
  });
  expect(switched.status, JSON.stringify(switched.json)).toBe(200);
  return { context, page, me };
}

async function decideAll(page: Page, slide: string, objects: string[]): Promise<void> {
  for (const object of objects) {
    const decided = await call(page, "PUT", `${slide}/decisions/${object}`, { answer: "5" });
    expect(decided.status, JSON.stringify(decided.json)).toBe(200);
  }
}

async function submit(page: Page, slide: string): Promise<void> {
  const first = await call(page, "POST", `${slide}/submit`);
  if (first.status === 200) return;
  expect(first.status, JSON.stringify(first.json)).toBe(409);
  const left = Reflect.get(first.json ?? {}, "current") as { unanswered_questions: string[] };
  const opinion = await call(page, "GET", `${slide}/opinion`);
  const questions = Reflect.get(opinion.json ?? {}, "questions") as Question[];
  const answers = Object.fromEntries(
    questions
      .filter((question) => left.unanswered_questions.includes(question.key))
      .map((question) => [question.key, fitting(question)]),
  );
  const answered = await call(page, "PUT", `${slide}/opinion`, { answers });
  expect(answered.status, JSON.stringify(answered.json)).toBe(200);
  const submitted = await call(page, "POST", `${slide}/submit`);
  expect(submitted.status, JSON.stringify(submitted.json)).toBe(200);
}

function bounds(points: number[][]): number[] {
  const xs = points.map(([x = 0]) => x);
  const ys = points.map(([, y = 0]) => y);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map(Math.round);
}

function unzip(path: string, flag: string, ...members: string[]): string {
  return execFileSync("unzip", [flag, path, ...members], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

test("a slide goes from upload through detection, review, adjudication and sign-off into a frozen dataset", async ({
  page,
  browser,
  researcher,
}) => {
  test.setTimeout(600_000);
  const contexts: BrowserContext[] = [];
  let zitadelUser = "";
  try {
    const project = await call(page, "POST", "/api/projects", { name: "Whole path" });
    expect(project.status, JSON.stringify(project.json)).toBe(201);
    const projectId = idOf(project);
    const made = await call(page, "POST", "/api/cases", { project_id: projectId, label: "WP-1" });
    expect(made.status, JSON.stringify(made.json)).toBe(201);

    await page.goto(`/projects/${projectId}/cases/${idOf(made)}/upload`);
    await expect(page.getByTestId("upload-drawer")).toBeVisible();
    await page.getByTestId("file-input").setInputFiles(fixturePath(SLIDE));
    await expect(page.getByTestId("upload-row")).toHaveAttribute("data-status", "done", {
      timeout: 60_000,
    });
    const slideUpload = sql(
      `SELECT id FROM uploads WHERE project_id = '${projectId}' AND file_name = '${SLIDE}'`,
    );
    const slideId = field(await uploadStatus(page, slideUpload), "slide_id");

    const detection = await call(page, "POST", `/api/projects/${projectId}/model-runs`, {
      slide_ids: [slideId],
      scope: { kind: "selection", geometry: selection },
      parameters: { tier: { task: "outline", tier: "good" } },
    });
    expect(detection.status, JSON.stringify(detection.json)).toBe(201);
    expect(detection.json).toMatchObject([{ slide_id: slideId, scope: { kind: "selection" } }]);
    const setId = await uploadCells(page, projectId, slideId);

    const second = await newReviewer();
    zitadelUser = second.userId;
    const reviewer = await joined(browser, researcher, projectId, second.email, second.secret);
    contexts.push(reviewer.context);
    const adjudicator = await joined(browser, researcher, projectId, adjudicatorUsername);
    contexts.push(adjudicator.context);

    const task = await call(page, "POST", `/api/projects/${projectId}/review-tasks`, {
      name: "Whole path review",
      kind: "review",
      slide_ids: [slideId],
      result_sets: [{ slide_id: slideId, result_set_id: setId }],
      reviewer_ids: [researcher.me, reviewer.me],
      split: "everyone",
      scope: { kind: "random-cells", count: 3 },
      blinded: false,
    });
    expect(task.status, JSON.stringify(task.json)).toBe(201);
    const taskId = idOf(task);
    const taskPath = `/api/review-tasks/${taskId}`;
    const slide = `${taskPath}/slides/${slideId}`;

    let listed: Reply = { status: 0, json: null };
    await expect
      .poll(
        async () => {
          listed = await call(page, "GET", `${slide}/objects`);
          return listed.status;
        },
        { timeout: 60_000, intervals: [500, 1_000] },
      )
      .not.toBe(409);
    expect(listed.status, JSON.stringify(listed.json)).toBe(200);
    const listedObjects = Reflect.get(listed.json ?? {}, "objects") as {
      object: string;
      outline: number[] | null;
    }[];
    const objects = listedObjects.map((item) => item.object);
    expect(objects).toHaveLength(3);
    const target = objects[0] ?? "";
    const redraw = redrawOf(listedObjects[0]?.outline ?? []);
    const start = redraw.coordinates[0]?.[0]?.[0];

    await decideAll(page, slide, objects);
    await decideAll(reviewer.page, slide, objects);
    const redrawn = await call(reviewer.page, "PUT", `${slide}/edits/${target}`, {
      geometry: redraw,
    });
    expect(redrawn.status, JSON.stringify(redrawn.json)).toBe(200);
    await submit(page, slide);
    await submit(reviewer.page, slide);

    const queue = await call(page, "GET", `${taskPath}/disagreement-queue`);
    expect(queue.status, JSON.stringify(queue.json)).toBe(200);
    expect(JSON.stringify(queue.json)).toContain(`"${target}"`);

    const sent = await call(page, "POST", `${taskPath}/disagreements/adjudications`, {
      adjudicator_user_id: adjudicator.me,
      objects: [{ slide_id: slideId, object: target }],
      note: "The outlines differ",
    });
    expect(sent.status, JSON.stringify(sent.json)).toBe(201);

    const mine = await call(adjudicator.page, "GET", `${taskPath}/adjudication`);
    expect(mine.status, JSON.stringify(mine.json)).toBe(200);
    const asked = (
      Reflect.get(mine.json ?? {}, "objects") as { object: string; outlines: Outline[] }[]
    ).find((item) => item.object === target);
    const picked = asked?.outlines.find((item) => Math.round(item.outline[0] ?? 0) === start);
    expect(picked, JSON.stringify(asked)).toBeDefined();
    const settled = await call(
      adjudicator.page,
      "PUT",
      `${taskPath}/adjudication/${slideId}/${target}/outline`,
      { reviewer: picked?.reviewer },
    );
    expect(settled.status, JSON.stringify(settled.json)).toBe(200);
    const decided = await call(
      adjudicator.page,
      "POST",
      `${taskPath}/adjudication/${slideId}/${target}`,
      { raw: "5", note: "The redrawn outline fits" },
    );
    expect(decided.status, JSON.stringify(decided.json)).toBe(200);

    const signer = await browser.newContext();
    contexts.push(signer);
    const owner = await signer.newPage();
    await signIn(owner, "/");
    const back = await call(owner, "PUT", "/api/me/workspace", { tenant_id: researcher.tenantId });
    expect(back.status, JSON.stringify(back.json)).toBe(200);
    const signed = await call(owner, "POST", `${taskPath}/sign-off`, {});
    expect(signed.status, JSON.stringify(signed.json)).toBe(200);
    expect(Reflect.get(signed.json ?? {}, "signed_off_at")).not.toBeNull();

    await owner.goto(`/tasks/${taskId}/dataset`);
    await expect(owner.getByTestId("dataset-no-versions")).toBeVisible({ timeout: 30_000 });
    await owner.getByTestId("dataset-note").fill("Whole path check");
    await owner.getByTestId("dataset-freeze").click();
    await expect(owner.getByTestId("dataset-version-1")).toBeVisible({ timeout: 30_000 });
    const download = owner.waitForEvent("download");
    await owner.getByTestId("dataset-version-1-download").click();
    const zip = await (await download).path();

    const names = unzip(zip, "-Z1").split("\n").filter(Boolean);
    const layers = names.filter((name) => name.endsWith(".geojson"));
    expect(layers, names.join(", ")).toHaveLength(1);
    const layer = JSON.parse(unzip(zip, "-p", layers[0] ?? "")) as { features: Feature[] };
    const { features } = layer;
    const edited = features.find((item) => item.properties.parfocal.source === target);
    const letters = [researcher.me, reviewer.me].sort();
    const letter = "AB"[letters.indexOf(reviewer.me)];
    expect(edited?.properties.parfocal, JSON.stringify(features)).toMatchObject({
      origin: "ai-edited",
      author: letter,
      changed_by: "C",
      source: target,
    });
    expect(bounds(edited?.geometry.coordinates[0] ?? [])).toEqual(
      bounds(redraw.coordinates[0] ?? []),
    );
    const confirmed = features.filter((item) => item.properties.parfocal.origin === "ai-confirmed");
    expect(confirmed).toHaveLength(2);
  } finally {
    for (const context of contexts) await context.close();
    if (zitadelUser !== "") await deleteZitadelUser(zitadelUser);
  }
});
