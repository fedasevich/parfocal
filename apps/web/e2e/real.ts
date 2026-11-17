import { expect, type Page } from "@playwright/test";

export const onRealApi = process.env["PARFOCAL_E2E_BACKEND"] === "real";

export const area = {
  login: "@login",
  upload: "@upload",
  review: "@review",
  annotate: "@annotate",
  signOff: "@sign-off",
  team: "@team",
} as const;

export const switchedAreas: readonly string[] = [area.login, area.upload, area.review];

export const realTags = (tag: (typeof area)[keyof typeof area]) => ({ tag: ["@real", tag] });

function fromEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set to run the @real specs on the real API`);
  return value;
}

export function credentials(): { email: string; password: string } {
  if (onRealApi) {
    return { email: fromEnv("ZITADEL_TEST_USERNAME"), password: fromEnv("ZITADEL_TEST_PASSWORD") };
  }
  return { email: "rui.researcher@parfocal.test", password: "correct-horse-staple" };
}

export async function signIn(page: Page, returnTo: string): Promise<void> {
  const { email, password } = credentials();
  await page.goto(`/sign-in?return_to=${encodeURIComponent(returnTo)}`);
  await page.getByRole("textbox", { name: "Work email" }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect
    .poll(() => new URL(page.url()).pathname, { timeout: 30_000 })
    .toBe(returnTo.split("?")[0]);
  if (onRealApi) await ensureActiveWorkspace(page);
}

async function ensureActiveWorkspace(page: Page): Promise<void> {
  const me = await ok<{ active_tenant_id: string | null; workspaces: { tenant_id: string }[] }>(
    page,
    "GET",
    "/api/me",
  );
  const first = me.workspaces[0]?.tenant_id;
  if (me.active_tenant_id !== null || first === undefined) return;
  await ok(page, "PUT", "/api/me/workspace", { tenant_id: first });
  await page.reload();
}

export interface Reply {
  status: number;
  json: unknown;
}

export async function call(page: Page, method: string, path: string, body?: unknown) {
  return page.evaluate(
    async ({ method, path, body }) => {
      const response = await fetch(path, {
        method,
        headers: body === undefined ? {} : { "content-type": "application/json" },
        body: body === undefined ? null : JSON.stringify(body),
      });
      const text = await response.text();
      let json: unknown = null;
      try {
        json = text === "" ? null : JSON.parse(text);
      } catch {
        json = text;
      }
      return { status: response.status, json };
    },
    { method, path, body },
  ) as Promise<Reply>;
}

export async function ok<T>(page: Page, method: string, path: string, body?: unknown): Promise<T> {
  const reply = await call(page, method, path, body);
  expect(reply.status, `${method} ${path} ${JSON.stringify(reply.json)}`).toBeLessThan(300);
  return reply.json as T;
}

export async function storageStandIn(page: Page, storage: string): Promise<void> {
  let counter = 0;
  await page.context().route(`${storage}/**`, async (route) => {
    const request = route.request();
    const headers = {
      "access-control-allow-origin": request.headers()["origin"] ?? "*",
      "access-control-allow-credentials": "true",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
      "access-control-expose-headers": "ETag, Location",
    };
    const method = request.method();
    const path = new URL(request.url()).pathname.replace(new URL(storage).pathname, "");
    if (method === "OPTIONS") return route.fulfill({ status: 204, headers });
    if (method === "GET" && path === "/uploads/open") {
      return route.fulfill({ status: 404, headers, json: { type: "no-open-upload" } });
    }
    if (method === "POST" && path === "/uploads/s3/multipart") {
      counter += 1;
      return route.fulfill({
        status: 201,
        headers,
        json: {
          key: `t/x/quarantine/${counter}/file`,
          uploadId: `up-${counter}`,
          part_size: 16777216,
          part_count: 1,
        },
      });
    }
    if (method === "GET" && /\/uploads\/s3\/multipart\/[^/]+\/\d+$/.test(path)) {
      const json = { url: `${storage}/part/${path.split("/")[4]}`, expires: 900 };
      return route.fulfill({ status: 200, headers, json });
    }
    if (method === "GET" && path.startsWith("/uploads/s3/multipart/")) {
      return route.fulfill({ status: 200, headers, json: [] });
    }
    if (method === "PUT" && path.startsWith("/part/")) {
      return route.fulfill({ status: 200, headers: { ...headers, etag: '"abc"' }, body: "" });
    }
    if (method === "POST" && path.endsWith("/complete")) {
      const json = { location: "/jobs/1", key: "k", uploadId: "u", job_id: "j", etag: "abc" };
      return route.fulfill({ status: 200, headers, json });
    }
    return route.fulfill({ status: 200, headers, json: {} });
  });
}

interface TaskRow {
  id: string;
  kind: string;
  slide_count: number;
}

interface TaskDetail {
  id: string;
  project_id: string;
  kind: string;
  slides: { slide_id: string }[];
}

export interface TaskOnSlide {
  project: string;
  task: string;
  slide: string;
}

const slideOf = (detail: TaskDetail) => detail.slides[0]?.slide_id ?? "";

export async function sampleTask(page: Page, kind: "review" | "annotate"): Promise<TaskOnSlide> {
  const project = (await ok<{ id: string }>(page, "POST", "/api/projects/sample")).id;
  const listed = await ok<TaskRow[]>(page, "GET", `/api/projects/${project}/review-tasks`);
  const row = listed.find((task) => task.kind === kind && task.slide_count > 0);
  let task = row?.id;
  if (task === undefined) {
    const me = (await ok<{ user_id: string }>(page, "GET", "/api/me")).user_id;
    const reviewing = listed.find((candidate) => candidate.slide_count > 0);
    expect(reviewing, "the sample project has a task with slides").toBeDefined();
    const source = await ok<TaskDetail>(page, "GET", `/api/review-tasks/${reviewing?.id ?? ""}`);
    const created = await ok<{ id: string }>(
      page,
      "POST",
      `/api/projects/${project}/review-tasks`,
      {
        name: "Real API annotate check",
        kind,
        slide_ids: [slideOf(source)],
        result_sets: [],
        reviewer_ids: [me],
        split: "everyone",
        scope: { kind: "whole-slide" },
        blinded: false,
      },
    );
    task = created.id;
  }
  const detail = await ok<TaskDetail>(page, "GET", `/api/review-tasks/${task}`);
  const slide = slideOf(detail);
  expect(slide, "the task has a slide").not.toBe("");
  return { project: detail.project_id, task, slide };
}
