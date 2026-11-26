import { round5Tasks } from "../src/study/study-model.ts";
import { expect, test } from "./a11y.ts";

test.use({ viewport: { width: 1440, height: 900 } });

const firstTask = round5Tasks[0]?.instruction ?? "";
const runsKey = "parfocal.fake.study-runs";

test("a remote participant opens one link in a fresh browser, reaches task 1 and the console follows", async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  await page.goto("/study/console");
  await page.getByRole("textbox", { name: "Code to prepare" }).fill("p-link");
  await page.getByRole("button", { name: "Make a join link" }).click();
  await expect(page.getByTestId("study-prepare-status")).toContainText("Study P-LINK is ready.");
  const url = await page.getByTestId("study-join-link").inputValue();
  expect(url).toMatch(/\/study\/join#fake-P-LINK-/);
  await expect(
    page.locator('[data-testid="study-remote-progress"][data-code="P-LINK"]'),
  ).toHaveAttribute("data-kind", "waiting");

  const remote = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const participant = await remote.newPage();
  await participant.goto(url);
  await expect(participant).toHaveURL(/\/study$/);
  await expect(participant.getByTestId("study-code")).toHaveText("P-LINK");
  await participant.getByRole("button", { name: "I agree and start" }).click();
  await expect(participant.getByTestId("study-goal-big")).toHaveText(firstTask);
  await expect(participant.getByTestId("study-start-blocked")).toHaveCount(0);
  await expect(participant.getByRole("button", { name: "Start task", exact: true })).toBeEnabled({
    timeout: 15_000,
  });

  await expect
    .poll(() => participant.evaluate((key) => localStorage.getItem(key) ?? "", runsKey), {
      timeout: 20_000,
    })
    .toContain('"participant":"P-LINK"');
  const uploaded = await participant.evaluate((key) => localStorage.getItem(key) ?? "", runsKey);
  await page.evaluate(({ key, value }) => localStorage.setItem(key, value), {
    key: runsKey,
    value: uploaded,
  });
  await page.reload();
  const progress = page.locator('[data-testid="study-remote-progress"][data-code="P-LINK"]');
  await expect(progress).toHaveAttribute("data-kind", "working");
  await expect(progress).toContainText(`0 of ${round5Tasks.length} tasks done`);

  const second = await remote.newPage();
  await second.goto(url);
  await expect(second.getByTestId("study-join-status")).toHaveText(
    "This link was used already or has expired. Ask the moderator for a new one.",
  );
  await remote.close();
});

test("a joined participant seat shows no New project and no Admin anywhere", async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  await page.goto("/study/console");
  await page.getByRole("textbox", { name: "Code to prepare" }).fill("p-seat");
  await page.getByRole("button", { name: "Make a join link" }).click();
  await expect(page.getByTestId("study-prepare-status")).toContainText("Study P-SEAT is ready.");
  await expect(page.getByRole("link", { name: "New project" })).toBeVisible();
  const url = await page.getByTestId("study-join-link").inputValue();

  const remote = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const participant = await remote.newPage();
  await participant.goto(url);
  await expect(participant).toHaveURL(/\/study$/);
  await participant.goto("/");
  await expect(participant.getByRole("link", { name: "Team" })).toBeVisible();
  await expect(participant.getByText("New project", { exact: true })).toHaveCount(0);
  await expect(participant.getByRole("link", { name: "Admin" })).toHaveCount(0);
  await participant.goto("/my-work");
  await expect(participant.getByRole("link", { name: "Team" })).toBeVisible();
  await expect(participant.getByText("New project", { exact: true })).toHaveCount(0);
  await expect(participant.getByRole("link", { name: "Admin" })).toHaveCount(0);
  await remote.close();
});
