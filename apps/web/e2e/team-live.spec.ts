import { expect, type Page, test } from "./a11y.ts";
import { area, ok, realTags, signIn } from "./real.ts";

interface Progress {
  user_id: string;
  slides_submitted: number;
  slides_assigned: number;
}

interface Assigned {
  id: string;
  code: string;
  status: string;
  reviewers: Progress[];
}

interface TeamRow {
  user_id: string;
  status: string;
  nudged_at: string | null;
  slides_done: number;
}

interface TeamTask {
  id: string;
  code: string;
  name: string;
  project: { id: string };
  reviewers: TeamRow[];
}

interface Team {
  open: TeamTask[];
}

interface Project {
  members: { user_id: string; role: string }[];
}

interface Member {
  user_id: string;
  display_name: string;
}

const team = (page: Page) => ok<Team>(page, "GET", "/api/me/team");

const rowOn = async (page: Page, taskId: string, userId: string) =>
  (await team(page)).open
    .find((task) => task.id === taskId)
    ?.reviewers.find((row) => row.user_id === userId);

const posted = (page: Page, path: RegExp, method: string) =>
  page.waitForResponse(
    (response) => response.request().method() === method && path.test(response.url()),
  );

const LIVE_TASK = "Team live check";

interface Listed {
  id: string;
  name: string;
  slide_count: number;
}

async function arrangeOtherReviewers(page: Page): Promise<void> {
  const me = (await ok<{ user_id: string }>(page, "GET", "/api/me")).user_id;
  const projects = await ok<{ id: string; name: string; my_role: string | null }[]>(
    page,
    "GET",
    "/api/projects",
  );
  const owned = projects.find((project) => project.my_role === "owner");
  expect(owned, "the signed-in researcher owns a project").toBeDefined();
  const projectId = owned?.id ?? "";
  const members = await ok<{ user_id: string; role: string }[]>(page, "GET", "/api/tenant/members");
  const reviewers = members.filter((member) => member.role === "reviewer" && member.user_id !== me);
  expect(reviewers.length, "the workspace has two reviewers besides me").toBeGreaterThanOrEqual(2);
  for (const reviewer of reviewers.slice(0, 2)) {
    await ok(page, "PUT", `/api/projects/${projectId}/members/${reviewer.user_id}`, {
      role: "reviewer",
    });
  }
  const listed = await ok<Listed[]>(page, "GET", `/api/projects/${projectId}/review-tasks`);
  if (listed.some((task) => task.name === LIVE_TASK)) return;
  const source = listed.find((task) => task.slide_count > 0);
  expect(source, "the project has a task with slides").toBeDefined();
  const detail = await ok<{ slides: { slide_id: string }[] }>(
    page,
    "GET",
    `/api/review-tasks/${source?.id ?? ""}`,
  );
  await ok(page, "POST", `/api/projects/${projectId}/review-tasks`, {
    name: LIVE_TASK,
    kind: "annotate",
    slide_ids: detail.slides.slice(0, 2).map((slide) => slide.slide_id),
    result_sets: [],
    reviewer_ids: [reviewers[0]?.user_id],
    split: "everyone",
    scope: { kind: "whole-slide" },
    blinded: false,
  });
}

const toast = (page: Page) => page.locator('[data-slot="toast"]');

test(
  "a nudge from Assigned by me is stored and Undo takes it back",
  realTags(area.team),
  async ({ page }) => {
    await signIn(page, "/my-work?tab=assigned");
    await arrangeOtherReviewers(page);
    const me = (await ok<{ user_id: string }>(page, "GET", "/api/me")).user_id;
    const assigned = await ok<Assigned[]>(page, "GET", "/api/me/assigned-tasks");
    const task = assigned.find(
      (candidate) =>
        (candidate.status === "in-review" || candidate.status === "not-started") &&
        candidate.reviewers.some(
          (row) => row.user_id !== me && row.slides_submitted < row.slides_assigned,
        ),
    );
    test.skip(task === undefined, "No task of mine has a reviewer with slides left");
    if (task === undefined) return;
    await page.goto("/my-work?tab=assigned");
    await page
      .getByRole("row")
      .filter({ hasText: task.code })
      .getByRole("button", { name: "Nudge" })
      .click();
    const dialog = page.getByRole("dialog", { name: "Nudge" });
    await expect(dialog.getByRole("textbox", { name: "Message" })).toHaveValue(/^Hi .+, /);
    const sent = posted(page, new RegExp(`/api/review-tasks/${task.id}/nudges$`), "POST");
    await dialog.getByRole("button", { name: /Send/ }).click();
    const reply = await sent;
    expect(reply.status()).toBe(201);
    const nudge = (await reply.json()) as { id: string; user_id: string };
    await expect(toast(page)).toContainText("Nudge sent to");
    const undone = posted(page, new RegExp(`/nudges/${nudge.id}$`), "DELETE");
    await toast(page).getByRole("button", { name: "Undo" }).click();
    expect((await undone).status()).toBe(204);
  },
);

test("a nudge and a reassign from Team are stored", realTags(area.team), async ({ page }) => {
  await signIn(page, "/team");
  await arrangeOtherReviewers(page);
  const myId = (await ok<{ user_id: string }>(page, "GET", "/api/me")).user_id;
  const open = (await team(page)).open;
  const pick = open
    .flatMap((task) => task.reviewers.map((row, index) => ({ task, row, index })))
    .find(
      ({ row }) =>
        row.user_id !== myId &&
        row.status !== "done" &&
        row.status !== "away" &&
        row.nudged_at === null,
    );
  test.skip(pick === undefined, "No open task has a reviewer to nudge");
  if (pick === undefined) return;
  const { task, row, index } = pick;
  await page.goto(`/team?project=${task.project.id}`);
  const block = page.getByRole("region", { name: `${task.code} · ${task.name}` });
  const reviewerRow = block.locator('[data-slot="reviewer-row"]').nth(index);
  await reviewerRow.getByRole("button", { name: "Nudge" }).click();
  const nudge = page.getByRole("dialog", { name: "Nudge" });
  const sent = posted(page, new RegExp(`/api/review-tasks/${task.id}/nudges$`), "POST");
  await nudge.getByRole("button", { name: /Send/ }).click();
  expect((await sent).status()).toBe(201);
  await expect(reviewerRow).toContainText("nudged just now");
  expect((await rowOn(page, task.id, row.user_id))?.nudged_at).not.toBeNull();
  await toast(page).getByRole("button", { name: "Undo" }).click();
  await expect.poll(async () => (await rowOn(page, task.id, row.user_id))?.nudged_at).toBeNull();

  const project = await ok<Project>(page, "GET", `/api/projects/${task.project.id}`);
  const members = await ok<Member[]>(page, "GET", "/api/tenant/members");
  const load = await ok<{ user_id: string }[]>(page, "GET", "/api/tenant/workload");
  const onTask = new Set([myId, ...task.reviewers.map((item) => item.user_id)]);
  const target = project.members.find(
    (member) =>
      (member.role === "owner" || member.role === "reviewer") &&
      !onTask.has(member.user_id) &&
      load.some((item) => item.user_id === member.user_id),
  );
  const name = members.find((member) => member.user_id === target?.user_id)?.display_name;
  test.skip(target === undefined || name === undefined, "Nobody else reviews in this project");
  if (target === undefined || name === undefined) return;
  await reviewerRow.getByRole("button", { name: "Reassign" }).click();
  const reassign = page.getByRole("dialog", { name: "Reassign slides" });
  await reassign.getByRole("combobox", { name: "To" }).fill(name.split(" ")[0] ?? name);
  await page
    .getByRole("option", { name: new RegExp(name) })
    .first()
    .click();
  const moved = posted(page, new RegExp(`/api/review-tasks/${task.id}/reassignments$`), "POST");
  await reassign.getByRole("button", { name: /^Reassign \d+ slides?/ }).click();
  expect((await moved).status()).toBe(201);
  await expect
    .poll(async () => (await rowOn(page, task.id, target.user_id)) !== undefined)
    .toBe(true);
  await toast(page).getByRole("button", { name: "Undo" }).click();
  await expect
    .poll(async () => (await rowOn(page, task.id, target.user_id)) === undefined)
    .toBe(true);
});
