import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import { setupServer } from "msw/node";
import {
  defaultFakeTeamScene,
  defaultFakeView,
  fakeApiHandlers,
  resetTeamActions,
  scenario,
  setFakeTeamScene,
  setFakeView,
  teamReviewerStatus,
} from "../src/fake/index.ts";
import {
  cancelNudge,
  getListTeamWorkloadQueryOptions,
  getNudgeReviewerMutationOptions,
  isDraftMeta,
  listTeamWorkload,
  nudgeReviewer,
  reassignSlides,
  type TeamTask,
  undoReassignment,
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
  setFakeTeamScene(defaultFakeTeamScene);
  resetTeamActions();
});

after(() => {
  server.close();
  globalThis.fetch = patchedFetch;
});

const { people } = scenario;

const keyOf = (userId: string): string =>
  Object.values(people).find((person) => person.id === userId)?.key ?? userId;

const rowsOf = (task: TeamTask | undefined): Record<string, string> =>
  Object.fromEntries(
    (task?.reviewers ?? []).map((row): [string, string] => [
      keyOf(row.user_id),
      `${row.status} ${row.slides_done}/${row.slides_assigned}`,
    ]),
  );

const asResearcher = async () => {
  setFakeView({ viewer: "DH", firstWeek: false });
  return (await listTeamWorkload()).data;
};

test("each status word follows the share of slides the time so far asks for", () => {
  const base = { assigned: 12, sentOn: "2026-10-09", dueOn: "2026-10-23", awayUntil: null };
  assert.equal(teamReviewerStatus({ ...base, done: 7, today: "2026-10-15" }), "on-track");
  assert.equal(teamReviewerStatus({ ...base, done: 4, today: "2026-10-15" }), "behind");
  assert.equal(teamReviewerStatus({ ...base, done: 0, today: "2026-10-15" }), "not-started");
  assert.equal(teamReviewerStatus({ ...base, done: 12, today: "2026-10-24" }), "done");
  assert.equal(
    teamReviewerStatus({ ...base, done: 2, today: "2026-10-15", awayUntil: "2026-10-19" }),
    "away",
  );
  assert.equal(teamReviewerStatus({ ...base, done: 11, today: "2026-10-24" }), "behind");
  assert.equal(teamReviewerStatus({ ...base, done: 0, today: "2026-10-24" }), "behind");
  assert.equal(teamReviewerStatus({ ...base, done: 0, today: "2026-10-23" }), "not-started");
});

test("Team lists the researcher's open tasks by due date with RT-14's numbers", async () => {
  const team = await asResearcher();
  assert.equal(team.as_of, scenario.scenarioNow);
  assert.deepEqual(
    team.open.map((task) => task.code),
    ["RT-14", "RT-15"],
  );
  assert.deepEqual(rowsOf(team.open[0]), { LM: "on-track 7/12", SM: "behind 4/12" });
  assert.deepEqual(rowsOf(team.open[1]), { AK: "not-started 0/12" });
  assert.equal(team.open[0]?.reviewers[1]?.minutes_left, 160);
  assert.deepEqual(
    team.done.map((task) => [task.code, task.signed_on]),
    [
      ["RT-11", "2026-10-14"],
      ["RT-09", "2026-10-09"],
    ],
  );
  assert.deepEqual(rowsOf(team.done[0]), {
    AK: "done 14/14",
    SM: "done 13/13",
    LM: "done 13/13",
  });
});

test("a reviewer sees no Team of their own", async () => {
  const team = (await listTeamWorkload()).data;
  assert.deepEqual(team.open, []);
});

test("the scenes move the clock, set an absence and add the task just sent", async () => {
  setFakeTeamScene({ ...defaultFakeTeamScene, now: "overdue" });
  let team = await asResearcher();
  assert.equal(team.as_of.slice(0, 10), "2026-10-24");
  assert.deepEqual(rowsOf(team.open[0]), { LM: "behind 7/12", SM: "behind 4/12" });

  setFakeTeamScene({ ...defaultFakeTeamScene, away: "AK" });
  team = await asResearcher();
  assert.equal(team.open[1]?.reviewers[0]?.status, "away");
  assert.equal(team.open[1]?.reviewers[0]?.away_until, "2026-10-19");

  setFakeTeamScene({ ...defaultFakeTeamScene, sent: true });
  team = await asResearcher();
  const sent = team.open.find((task) => task.code === "RT-16");
  assert.equal(sent?.slides, 9);
  assert.equal(sent?.due_on, "2026-10-30");
  assert.deepEqual(rowsOf(sent), { LM: "not-started 0/9", SM: "not-started 0/9" });
});

test("a nudge marks the row and its undo clears it", async () => {
  let team = await asResearcher();
  const task = team.open[0] as TeamTask;
  const simona = people.SM.id;
  const sent = await nudgeReviewer(task.id, { user_id: simona, message: "Could you?" });
  team = await asResearcher();
  assert.equal(
    team.open[0]?.reviewers.find((row) => row.user_id === simona)?.nudged_at,
    scenario.scenarioNow,
  );
  await cancelNudge(task.id, sent.data.id);
  team = await asResearcher();
  assert.equal(team.open[0]?.reviewers.find((row) => row.user_id === simona)?.nudged_at, null);
});

test("reassigning moves the slides not started, or all of them, and undo puts them back", async () => {
  let team = await asResearcher();
  const task = team.open[0] as TeamTask;
  const rest = await reassignSlides(task.id, {
    from_user_id: people.SM.id,
    to_user_id: people.JR.id,
    what: "not-started",
    note: null,
  });
  assert.equal(rest.data.slides_moved, 8);
  team = await asResearcher();
  assert.deepEqual(rowsOf(team.open[0]), {
    LM: "on-track 7/12",
    SM: "done 4/4",
    JR: "not-started 0/8",
  });
  await undoReassignment(task.id, rest.data.id);

  const all = await reassignSlides(task.id, {
    from_user_id: people.SM.id,
    to_user_id: people.JR.id,
    what: "all",
    note: "For both of you",
  });
  assert.equal(all.data.slides_moved, 12);
  team = await asResearcher();
  assert.deepEqual(rowsOf(team.open[0]), { LM: "on-track 7/12", JR: "not-started 0/12" });
  await undoReassignment(task.id, all.data.id);
  team = await asResearcher();
  assert.deepEqual(rowsOf(team.open[0]), { LM: "on-track 7/12", SM: "behind 4/12" });
});

test("a reassign to someone who already reviews the task is refused", async () => {
  const team = await asResearcher();
  const task = team.open[0] as TeamTask;
  await assert.rejects(
    reassignSlides(task.id, {
      from_user_id: people.SM.id,
      to_user_id: people.LM.id,
      what: "not-started",
      note: null,
    }),
    (error: { status?: number }) => error.status === 409,
  );
});

test("the team drafts carry the draft marker", () => {
  assert.ok(isDraftMeta(getListTeamWorkloadQueryOptions().meta));
  assert.deepEqual(getNudgeReviewerMutationOptions().meta, { draft: "nudgeReviewer" });
});
