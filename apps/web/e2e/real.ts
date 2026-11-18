import { expect, type Page } from "@playwright/test";

export const onRealApi = process.env["PARFOCAL_E2E_BACKEND"] === "real";

export const area = {
  login: "@login",
  upload: "@upload",
  review: "@review",
  annotate: "@annotate",
  signOff: "@sign-off",
  team: "@team",
  project: "@project",
  viewer: "@viewer",
  models: "@models",
  reports: "@reports",
  admin: "@admin",
} as const;

export const switchedAreas: readonly string[] = [
  area.login,
  area.upload,
  area.review,
  area.annotate,
  area.signOff,
  area.team,
  area.project,
  area.viewer,
  area.models,
  area.reports,
  area.admin,
];

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
  const later = page.getByRole("button", { name: "Not now", exact: true });
  await expect
    .poll(async () => (await later.isVisible()) || new URL(page.url()).pathname !== "/sign-in", {
      timeout: 30_000,
    })
    .toBe(true);
  if (await later.isVisible()) await later.click();
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
  name: string;
  slide_count: number;
}

interface TaskDetail {
  id: string;
  project_id: string;
  kind: string;
  slides: { slide_id: string }[];
}

interface ProjectRow {
  id: string;
  my_role: string | null;
  archived_at: string | null;
  privacy_mode: string;
}

interface TaskStates {
  signed_off_at: string | null;
  slides: { state: string }[];
}

export interface TaskOnSlide {
  project: string;
  task: string;
  slide: string;
}

const OWN_TASK = "Real API check";

interface TileGrant {
  token: string;
  base_path: string;
  original: string;
}

async function hasTiles(page: Page, slide: string): Promise<boolean> {
  const access = await call(page, "GET", `/api/slides/${slide}/tile-access`);
  if (access.status !== 200) return false;
  return page.evaluate(async ({ token, base_path, original }: TileGrant) => {
    const response = await fetch(`${base_path}${encodeURIComponent(original)}`, {
      headers: { Authorization: `Bearer ${token}`, Range: "bytes=0-15" },
    });
    return response.ok;
  }, access.json as TileGrant);
}

async function openProjects(page: Page): Promise<ProjectRow[]> {
  const projects = await ok<ProjectRow[]>(page, "GET", "/api/projects");
  return projects.filter((row) => row.archived_at === null && row.privacy_mode !== "clinical");
}

interface FoundSlide {
  project: string;
  slide: string;
  resultSet: string;
}

async function opensInViewer(page: Page, project: string, slide: string): Promise<boolean> {
  await page.goto(`/projects/${project}/slides/${slide}`);
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", /^(ready|failed)$/, { timeout: 45_000 });
  return (await stage.getAttribute("data-state")) === "ready";
}

async function slideWithTiles(page: Page): Promise<FoundSlide> {
  const projects = (await openProjects(page)).filter((row) => row.my_role === "owner");
  for (const project of projects) {
    const slides = await ok<{ id: string }[]>(page, "GET", `/api/projects/${project.id}/slides`);
    for (const slide of slides) {
      if (!(await hasTiles(page, slide.id))) continue;
      const sets = await ok<{ id: string; status: string }[]>(
        page,
        "GET",
        `/api/slides/${slide.id}/result-sets`,
      );
      const ready = sets.find((set) => set.status === "ready");
      if (ready === undefined || !(await opensInViewer(page, project.id, slide.id))) continue;
      return { project: project.id, slide: slide.id, resultSet: ready.id };
    }
  }
  throw new Error("No slide in a project the user owns has a file the viewer can open");
}

async function createTask(
  page: Page,
  found: FoundSlide,
  kind: "review" | "annotate",
  name: string,
): Promise<string> {
  const me = (await ok<{ user_id: string }>(page, "GET", "/api/me")).user_id;
  const sets = kind === "review" ? [{ slide_id: found.slide, result_set_id: found.resultSet }] : [];
  const created = await ok<{ id: string }>(
    page,
    "POST",
    `/api/projects/${found.project}/review-tasks`,
    {
      name,
      kind,
      slide_ids: [found.slide],
      result_sets: sets,
      reviewer_ids: [me],
      split: "everyone",
      scope: { kind: kind === "review" ? "all-regions" : "whole-slide" },
      blinded: false,
    },
  );
  return created.id;
}

async function seededTask(page: Page, kind: "review" | "annotate"): Promise<TaskOnSlide> {
  for (const project of await openProjects(page)) {
    const listed = await ok<TaskRow[]>(page, "GET", `/api/projects/${project.id}/review-tasks`);
    for (const row of listed.filter((task) => task.kind === kind && task.slide_count > 0)) {
      const detail = await ok<TaskDetail>(page, "GET", `/api/review-tasks/${row.id}`);
      const slide = detail.slides[0]?.slide_id;
      if (slide !== undefined) return { project: detail.project_id, task: row.id, slide };
    }
  }
  throw new Error(`No ${kind} task in an open project has a slide`);
}

async function seededTaskReadyToSign(page: Page): Promise<string> {
  for (const project of await openProjects(page)) {
    const listed = await ok<TaskRow[]>(page, "GET", `/api/projects/${project.id}/review-tasks`);
    for (const row of listed.filter((task) => task.kind === "review")) {
      const states = await ok<TaskStates>(page, "GET", `/api/review-tasks/${row.id}/states`);
      const allIn = states.slides.every(({ state }) => state === "submitted");
      if (states.signed_off_at === null && states.slides.length > 0 && allIn) return row.id;
    }
  }
  throw new Error("No unsigned review task has every review in");
}

export async function viewableTask(
  page: Page,
  kind: "review" | "annotate",
  fresh = false,
): Promise<TaskOnSlide> {
  if (!onRealApi) return seededTask(page, kind);
  const found = await slideWithTiles(page);
  const { project, slide } = found;
  const own = `${OWN_TASK} ${kind} ${slide.slice(0, 8)}`;
  const name = fresh ? `${own} ${Date.now()}` : own;
  const listed = await ok<TaskRow[]>(page, "GET", `/api/projects/${project}/review-tasks`);
  const existing = listed.find((task) => task.name === name && task.kind === kind);
  const task = existing?.id ?? (await createTask(page, found, kind, name));
  return { project, task, slide };
}

export async function taskWithEveryReviewIn(page: Page): Promise<string> {
  if (!onRealApi) return seededTaskReadyToSign(page);
  const found = await slideWithTiles(page);
  const { slide } = found;
  const task = await createTask(page, found, "review", `${OWN_TASK} sign-off ${Date.now()}`);
  const base = `/api/review-tasks/${task}/slides/${slide}`;
  const { objects } = await ok<{ objects: { object: string }[] }>(page, "GET", `${base}/objects`);
  for (const { object } of objects) {
    await ok(page, "PUT", `${base}/decisions/${object}`, { answer: "5" });
  }
  await ok(page, "PUT", `${base}/opinion`, { answers: { acceptable: 4 } });
  await ok(page, "POST", `${base}/submit`);
  const states = await ok<TaskStates>(page, "GET", `/api/review-tasks/${task}/states`);
  expect(states.signed_off_at).toBeNull();
  expect(states.slides.every(({ state }) => state === "submitted")).toBe(true);
  return task;
}
