import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import { setupServer } from "msw/node";
import {
  defaultFakeView,
  fakeApiHandlers,
  resetAdminActions,
  scenario,
  scenarioAdmin,
  setFakeView,
} from "../src/fake/index.ts";
import {
  createInvitation,
  getAdminOverview,
  getInvitePreview,
  getMe,
  getStorageUsage,
  listAiModels,
  listInvitations,
  listMemberActivity,
  listStudyTemplates,
  listTenantMembers,
  requestProjectAccess,
} from "../src/index.ts";

const server = setupServer(...fakeApiHandlers("all"));
let patchedFetch: typeof fetch;

before(() => {
  server.listen({ onUnhandledFrame: "error" });
  patchedFetch = globalThis.fetch;
  globalThis.fetch = (input, init) =>
    patchedFetch(new URL(input instanceof Request ? input.url : input, "http://app.test"), init);
});

afterEach(() => {
  setFakeView(defaultFakeView);
  resetAdminActions();
});

after(() => {
  server.close();
  globalThis.fetch = patchedFetch;
});

const okBody = <Body>(response: { status: number; data: unknown }) => {
  assert.equal(response.status, 200);
  return response.data as Body;
};

test("the overview counts what the admin lists hold", async () => {
  const overview = (await getAdminOverview()).data;
  const invitations = okBody<unknown[]>(await listInvitations());
  const models = (await listAiModels()).data;
  assert.equal(overview.invites_waiting, invitations.length);
  assert.equal(overview.invites_waiting, 3);
  assert.equal(overview.models, models.models.filter((model) => model.shown).length);
  assert.equal(overview.models, 6);
  assert.equal(overview.runs_now, models.running.length);
  assert.equal(overview.people, overview.researchers + overview.reviewers);
});

test("storage parts add up to what the overview says is stored", async () => {
  const usage = (await getStorageUsage()).data;
  const overview = (await getAdminOverview()).data;
  const stored = usage.parts.reduce((sum, part) => sum + part.tb, 0);
  assert.equal(Math.round(stored * 10) / 10, overview.stored_tb);
  assert.ok(overview.stored_tb <= overview.capacity_tb);
  const largestFirst = usage.by_project.map((row) => row.gb);
  assert.deepEqual(
    largestFirst,
    [...largestFirst].sort((a, b) => b - a),
  );
});

test("only researchers hold admin rights, and Daniel is one of them", async () => {
  const members = okBody<{ initials: string; role: string; admin_rights: boolean }[]>(
    await listTenantMembers(),
  );
  const holders = members.filter((member) => member.admin_rights);
  assert.deepEqual(
    holders.map((member) => member.initials),
    ["DH"],
  );
  assert.ok(holders.every((member) => member.role === "researcher"));
  setFakeView({ viewer: "DH", firstWeek: false });
  const me = okBody<{ workspaces: { admin_rights: boolean }[] }>(await getMe());
  assert.equal(me.workspaces[0]?.admin_rights, true);
});

test("member activity lists each member's projects from the seed", async () => {
  const rows = (await listMemberActivity()).data;
  const daniel = rows.find((row) => row.user_id === scenario.people.DH.id);
  assert.deepEqual(daniel?.project_codes, ["P07", "P09", "P11"]);
  const simona = rows.find((row) => row.user_id === scenario.people.SM.id);
  assert.equal(simona?.status, "invited");
  assert.equal(simona?.last_active_at, null);
});

test("a new invitation joins the waiting list and lowercases the email", async () => {
  const response = await createInvitation({ email: " New.Person@Lab.example ", role: "reviewer" });
  assert.equal(response.status, 201);
  const invitations = okBody<{ email: string }[]>(await listInvitations());
  assert.equal(invitations.length, 4);
  assert.equal(invitations.at(-1)?.email, "new.person@lab.example");
  assert.equal((await getAdminOverview()).data.invites_waiting, 4);
});

test("the invite preview is RT-14 with the scenario's numbers", async () => {
  const preview = (await getInvitePreview(scenarioAdmin.inviteSeed.invitation)).data;
  const task = scenario.reviewTasks.find((item) => item.code === "RT-14");
  assert.equal(preview.task.code, "RT-14");
  assert.equal(preview.task.slides, task?.slides);
  assert.equal(preview.task.due_on, task?.dueOn);
  assert.equal(preview.project.privacy_mode, "de-identified");
  assert.equal(preview.invited_by.display_name, "Daniel Hruška");
});

test("study templates carry their report blocks in order", async () => {
  const templates = okBody<{ name: string; blocks: { kind: string }[] }[]>(
    await listStudyTemplates(),
  );
  const sentinel = templates.find((item) => item.name === "Sentinel node AI evaluation");
  assert.deepEqual(
    sentinel?.blocks.map((block) => block.kind),
    [
      "headline-numbers",
      "confusion-matrix",
      "disagreement-reasons",
      "opinion-answers",
      "worst-objects",
    ],
  );
  assert.ok(templates.every((item) => item.blocks.length === 5));
});

test("asking for access names the project's owner", async () => {
  const project = scenario.projectByCode("P03");
  const asked = (await requestProjectAccess(project.id)).data;
  assert.equal(asked.project_id, project.id);
  assert.equal(asked.owner_id, scenario.people.LM.id);
});
