import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const p09 = "00000000-0000-4000-8003-000000000009";
const a1 = "00000000-0000-4000-8005-000000000001";
const tumor044 = "00000000-0000-4000-8005-000000000005";
const lymphNode = "00000000-0000-4000-8005-000000000013";
const rt14 = "00000000-0000-4000-8007-000000000014";
const annotateTask = "00000000-0000-4000-8007-000000000021";

test.use({ viewport: { width: 1440, height: 900 } });

async function ready(page: Page) {
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 20_000 });
  return stage;
}

async function servedAsClinical(page: Page, projectId: string) {
  await page.addInitScript((id) => {
    const original = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const response = await original(input, init);
      const url = typeof input === "string" ? input : input instanceof Request ? input.url : "";
      if (!new URL(url, window.location.href).pathname.endsWith(`/api/projects/${id}`))
        return response;
      const body = (await response.clone().json()) as Record<string, unknown>;
      return new Response(JSON.stringify({ ...body, privacy_mode: "clinical" }), {
        status: response.status,
        headers: response.headers,
      });
    };
  }, projectId);
}

test("a reviewed slide on a case with a report still submits from the top bar", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await servedAsClinical(page, p07);
  await page.goto(`/projects/${p07}/slides/${a1}?task=${rt14}&mode=guided`);
  const panel = page.getByTestId("stage-review-objects");
  await expect(panel).toHaveAttribute("data-ready", "true", { timeout: 25_000 });
  await page.getByRole("button", { name: "Got it, start" }).click();
  const bar = page.getByTestId("live-top-bar");
  await expect(bar.getByRole("button", { name: "Open report" })).toHaveAttribute(
    "data-variant",
    "secondary",
  );
  const submit = bar.getByTestId("top-submit");
  await expect(submit).toBeDisabled();
  for (let step = 0; step < 60; step += 1) {
    if (await page.getByTestId("stage-opinion").isVisible()) break;
    const at = (await panel.getAttribute("data-current")) ?? "";
    await page.keyboard.press("k");
    await expect
      .poll(async () => {
        const done = await page.getByTestId("stage-opinion").isVisible();
        return done ? "done" : panel.getAttribute("data-current");
      })
      .not.toBe(at);
  }
  await expect(submit).toBeEnabled({ timeout: 15_000 });
  await submit.click();
  await expect(page).toHaveURL(new RegExp(`/tasks/${rt14}/submitted|[?&]submitted=`));
});

test("cells mode opens read only for a person not assigned to the cell task", async ({ page }) => {
  await page.goto(`/projects/${p07}/slides/${a1}?task=${rt14}&mode=cells&as=DH`);
  const stage = await ready(page);
  await expect(stage).toHaveAttribute("data-access", "read-only", { timeout: 15_000 });
  await expect(page.getByTestId("stage-cells-grid")).toBeVisible({ timeout: 15_000 });
  await expect(page).toHaveURL(/mode=cells/);
  await expect(page.getByTestId("mode-fallback")).toHaveCount(0);
});

test("an annotate task never started shows no signed off lock to someone not assigned", async ({
  page,
}) => {
  await page.goto(
    `/projects/${p07}/slides/${tumor044}?task=${annotateTask}&tab=objects&issue=unassigned`,
  );
  const stage = await ready(page);
  await expect(stage).toHaveAttribute("data-access", "read-only", { timeout: 15_000 });
  await expect(page.getByTestId("read-only-notice")).toBeVisible();
  await expect(page.locator('[data-slot="sign-off-card"]')).toHaveCount(0);
  await expect(page.getByText("is locked. Later changes go to the change log.")).toHaveCount(0);
});

test("a slide outside the task says so and offers the task or the slide alone", async ({
  page,
}) => {
  await page.goto(`/projects/${p09}/slides/${lymphNode}?task=${rt14}&mode=guided`);
  const notice = page.getByTestId("issue-slide-outside-task");
  await expect(notice).toContainText("This slide is not part of the task", { timeout: 15_000 });
  await expect(page.getByText("Loading the review")).toHaveCount(0);
  await notice.getByRole("button", { name: "Open the slide alone" }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${p09}/slides/${lymphNode}$`));
  await page.goto(`/projects/${p09}/slides/${lymphNode}?task=${rt14}`);
  await page
    .getByTestId("issue-slide-outside-task")
    .getByRole("button", { name: "Open the task" })
    .click();
  await expect(page).toHaveURL(new RegExp(`/projects/${p07}/slides/[0-9a-f-]+\\?task=${rt14}`));
  await ready(page);
});

test("the queue header counts only the objects still waiting for a decision", async ({ page }) => {
  await page.goto(`/tasks/${rt14}/disagreements`);
  const header = page.getByText(/objects need a decision out of/);
  await expect(header).toBeVisible({ timeout: 15_000 });
  const numbers = async () => {
    const text = (await header.textContent()) ?? "";
    const match = /(\d+) objects need a decision out of \d+ · (\d+) resolved/.exec(text);
    return match ? { open: Number(match[1]), resolved: Number(match[2]) } : null;
  };
  const before = await numbers();
  expect(before).not.toBeNull();
  await page.keyboard.press("k");
  await expect
    .poll(numbers)
    .toEqual({ open: (before?.open ?? 0) - 1, resolved: (before?.resolved ?? 0) + 1 });
});

test("a finished adjudication leaves To review and the count", async ({ page }) => {
  await page.goto("/my-work?as=AK");
  const tasks = page.getByRole("list", { name: "Your tasks" });
  await expect(tasks).toContainText("Decide 3 objects on RT-14", { timeout: 15_000 });
  await expect(tasks).not.toContainText("All decided");
  await expect(tasks).not.toContainText("on RT-09");
});
