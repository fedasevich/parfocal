import assert from "node:assert/strict";
import { test } from "node:test";
import type { TeamReviewer, TeamTask, TeamWorkload } from "@parfocal/api-client";
import { fakeTeamSceneFor } from "../src/fake-api/team-scene-rules.ts";
import { fakeViewFor } from "../src/fake-api/view-rules.ts";
import { teamState } from "../src/screens/team/scenes.ts";
import {
  behindRows,
  dueText,
  durationText,
  headerLine,
  nudgeAllQuestion,
  nudgeMessage,
  reviewerDetail,
} from "../src/screens/team/team-text.ts";

const asOf = "2026-10-15T14:30:00+02:00";

const reviewer = (patch: Partial<TeamReviewer>): TeamReviewer => ({
  user_id: "sm",
  slides_done: 4,
  slides_assigned: 12,
  status: "behind",
  minutes_left: 160,
  away_until: null,
  assigned_at: "2026-10-09T09:00:00+02:00",
  last_decision_at: null,
  nudged_at: null,
  ...patch,
});

const task = (patch: Partial<TeamTask>): TeamTask => ({
  id: "rt14",
  code: "RT-14",
  name: "Round 2 · CAMELYON v1.0",
  project: { id: "p07", code: "P07", name: "Sentinel node AI evaluation" },
  slides: 12,
  split: "all",
  sent_on: "2026-10-09",
  due_on: "2026-10-23",
  signed_on: null,
  reviewers: [reviewer({ user_id: "lm", slides_done: 7, status: "on-track" }), reviewer({})],
  ...patch,
});

test("the due line counts days from the server's clock", () => {
  assert.deepEqual(dueText(task({}), asOf), {
    due: "Fri 23 Oct",
    dueIn: "in 8 days",
    overdue: false,
  });
  assert.deepEqual(dueText(task({}), "2026-10-24T09:00:00+02:00"), {
    due: "Fri 23 Oct",
    dueIn: "overdue by 1 day",
    overdue: true,
  });
  assert.equal(dueText(task({ due_on: "2026-10-15" }), asOf).dueIn, "today");
});

test("each reviewer row says what the mock says", () => {
  assert.equal(reviewerDetail(reviewer({}), asOf), "8 slides left · about 2 h 40 min");
  assert.equal(
    reviewerDetail(reviewer({ status: "done", slides_done: 12 }), asOf),
    "all 12 submitted",
  );
  assert.equal(
    reviewerDetail(reviewer({ status: "away", away_until: "2026-10-19" }), asOf),
    "until Mon 19 Oct",
  );
  assert.equal(
    reviewerDetail(
      reviewer({ status: "on-track", last_decision_at: "2026-10-15T14:20:00+02:00" }),
      asOf,
    ),
    "last decision 10 min ago",
  );
  assert.equal(
    reviewerDetail(reviewer({ status: "not-started", slides_done: 0, assigned_at: asOf }), asOf),
    "told just now",
  );
  assert.equal(
    reviewerDetail(reviewer({ status: "not-started", slides_done: 0 }), asOf),
    "not opened yet",
  );
  assert.equal(durationText(40), "40 min");
});

test("the header, the nudge text and Nudge all behind follow the rows", () => {
  const workload: TeamWorkload = { as_of: asOf, open: [task({})], done: [] };
  assert.equal(headerLine(workload), "1 open task · 1 reviewer behind");
  assert.equal(
    nudgeMessage("Simona Marková", task({}), reviewer({}), asOf),
    "Hi Simona, RT-14 is due Fri 23 Oct and 8 slides are left. Could you fit some in this week?",
  );
  assert.equal(behindRows(workload.open).length, 1);
  assert.equal(behindRows([task({ reviewers: [reviewer({ nudged_at: asOf })] })]).length, 0);
  assert.equal(nudgeAllQuestion(["Simona"], 1), "Nudge Simona?");
  assert.equal(nudgeAllQuestion(["Simona", "Jan"], 2), "Nudge 2 people?");
});

test("the scenes pick the tab, the highlight and the fake server state", () => {
  const workload: TeamWorkload = {
    as_of: asOf,
    open: [task({}), task({ id: "rt16", code: "RT-16", sent_on: "2026-10-15" })],
    done: [],
  };
  assert.equal(teamState({ scene: "done" }, workload).tab, "done");
  assert.equal(teamState({ scene: "done", tab: "open" }, workload).tab, "open");
  assert.equal(teamState({ scene: "sent" }, workload).task, "rt16");
  const signoff = teamState({ scene: "signoff" }, workload);
  assert.deepEqual([signoff.task, signoff.focus], ["rt14", "sm"]);
  assert.equal(fakeTeamSceneFor("/team", { scene: "overdue" }).now, "overdue");
  assert.equal(fakeTeamSceneFor("/team", { scene: "away" }).away, "AK");
  assert.equal(fakeTeamSceneFor("/team", { scene: "sent" }).sent, true);
  assert.equal(fakeTeamSceneFor("/my-work", { scene: "sent" }).sent, false);
  assert.equal(fakeViewFor("/team", {}).viewer, "DH");
});
