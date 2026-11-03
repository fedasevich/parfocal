import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { getResponse } from "msw";
import { setupServer } from "msw/node";
import { fakeApiHandlers, scenario } from "../src/fake/index.ts";
import { getGetHealthMockHandler } from "../src/generated/api.msw.ts";
import {
  ApiError,
  getHealth,
  getMe,
  getMyHome,
  getProject,
  getTileAccess,
  listMyJobs,
  listMyReviewTasks,
  listProjects,
  listTenantMembers,
} from "../src/index.ts";

const server = setupServer(...fakeApiHandlers("all"));
let patchedFetch: typeof fetch;

before(() => {
  server.listen({ onUnhandledFrame: "error" });
  patchedFetch = globalThis.fetch;
  globalThis.fetch = (input, init) =>
    patchedFetch(new URL(input instanceof Request ? input.url : input, "http://app.test"), init);
});

after(() => {
  globalThis.fetch = patchedFetch;
  server.close();
});

function body<Response extends { status: number; data: unknown }>(
  response: Response,
): Extract<Response, { status: 200 }>["data"] {
  assert.equal(response.status, 200);
  return (response as Extract<Response, { status: 200 }>).data;
}

const answers = async (scope: "all" | "drafts", path: string) =>
  (await getResponse(fakeApiHandlers(scope), new Request(`http://app.test${path}`))) !== undefined;

test("all answers generated, seeded and draft operations", async () => {
  assert.equal(await answers("all", "/api/health"), true);
  assert.equal(await answers("all", "/api/me"), true);
  assert.equal(await answers("all", "/api/me/jobs"), true);
});

test("drafts answers only draft operations and lets the rest reach the API", async () => {
  assert.equal(await answers("drafts", "/api/me/jobs"), true);
  assert.equal(await answers("drafts", "/api/me"), false);
  assert.equal(await answers("drafts", "/api/health"), false);
  assert.equal(await answers("drafts", "/api/projects"), false);
});

test("seeded operations tell the scenario's story ahead of generated fake data", async () => {
  const me = body(await getMe());
  assert.equal(me.display_name, "Lenka Malá");
  assert.equal(me.workspaces[0]?.name, "Fakultní nemocnice Vltava");
  const projects = body(await listProjects());
  assert.deepEqual(
    projects.map((project) => project.code),
    ["P07", "P03", "P09", "P11"],
  );
  const home = body(await getMyHome());
  assert.equal(home.resume?.task_code, "RT-14");
  assert.equal(home.resume?.object_id, "T5");
  const tasks = body(await listMyReviewTasks());
  assert.deepEqual(
    tasks.map((task) => task.code),
    ["RT-14", "RT-11", "RT-09"],
  );
});

test("the workspace's members are the scenario's people with their initials and colours", async () => {
  const members = body(await listTenantMembers());
  const daniel = members.find((member) => member.initials === "DH");
  assert.equal(daniel?.display_name, "Daniel Hruška");
  assert.equal(daniel?.role, "researcher");
  assert.equal(daniel?.avatar_colour, scenario.people.DH.colour);
  assert.equal(members.length, Object.keys(scenario.people).length);
});

test("a seeded detail answers by id and refuses an unknown one with a problem", async () => {
  const p07 = scenario.projectByCode("P07");
  const project = body(await getProject(p07.id));
  assert.equal(project.name, "Sentinel node AI evaluation");
  await assert.rejects(getProject("00000000-0000-4000-8000-000000000000"), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 404);
    return true;
  });
});

test("each seeded project lists the viewer parts of its analysis template", async () => {
  const base = ["objects", "layers", "decisions", "opinion"];
  const parts = Object.fromEntries(
    body(await listProjects()).map((project) => [project.code, project.viewer_parts]),
  );
  assert.deepEqual(parts, {
    P07: [...base, "staging-hero", "area-list", "measure-step"],
    P03: [...base, "staging-hero", "area-list", "measure-step"],
    P09: [...base, "unsure-zones", "cell-typing"],
    P11: base,
  });
  const p11 = scenario.projectByCode("P11");
  assert.deepEqual(body(await getProject(p11.id)).viewer_parts, base);
});

test("operations outside the seed still answer with typed generated data", async () => {
  assert.equal(typeof body(await getHealth()).status, "string");
});

test("a draft hook's fetch function reads its handler through the Zod schema", async () => {
  const response = await listMyJobs();
  assert.deepEqual(
    response.data.map((job) => [job.project.code, job.status]),
    [
      ["P07", "running"],
      ["P07", "paused"],
      ["P09", "done"],
      ["P09", "done"],
    ],
  );
});

test("an override replaces the generated fake body", async () => {
  server.use(getGetHealthMockHandler({ status: "fake" }));
  assert.deepEqual(body(await getHealth()), { status: "fake" });
  server.resetHandlers();
});

test("tile access names the slide's own path and a ten-minute lifetime", async () => {
  const access = body(
    await getTileAccess("slide-1", { headers: { "Previous-Tile-Token": "old" } }),
  );
  assert.equal(access.base_path, "/tiles/slide-1/");
  assert.equal(access.lifetime_seconds, 600);
  assert.equal(access.original, "slide.tiff");
  assert.equal(access.format, "generic-tiff");
});
