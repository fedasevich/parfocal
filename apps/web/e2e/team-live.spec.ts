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

const toast = (page: Page) => page.locator('[data-slot="toast"]');

test(
  "a nudge from Assigned by me is stored and Undo takes it back",
  realTags(area.team),
  async ({ page }) => {
    await signIn(page, "/my-work");
    const assigned = await ok<Assigned[]>(page, "GET", "/api/me/assigned-tasks");
    const task = assigned.find(
      (candidate) =>
        (candidate.status === "in-review" || candidate.status === "not-started") &&
        candidate.reviewers.some((row) => row.slides_submitted < row.slides_assigned),
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
  const open = (await team(page)).open;
  const pick = open
    .flatMap((task) => task.reviewers.map((row, index) => ({ task, row, index })))
    .find(({ row }) => row.status !== "done" && row.status !== "away" && row.nudged_at === null);
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
  const me = (await ok<{ user_id: string }>(page, "GET", "/api/me")).user_id;
  const load = await ok<{ user_id: string }[]>(page, "GET", "/api/tenant/workload");
  const onTask = new Set([me, ...task.reviewers.map((item) => item.user_id)]);
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
