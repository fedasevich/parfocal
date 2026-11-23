import { expect, type Page, test } from "./a11y.ts";

test.use({ viewport: { width: 1280, height: 900 } });

const tasks = [
  {
    id: "open",
    title: "Open the slide",
    instruction: "Open the tumor_044 slide from the list.",
    slide: "tumor_044",
    startPath: "/projects/{project}?tab=slides",
    check: { path: "/slides/{slide}(\\?|$)" },
  },
  {
    id: "look",
    title: "Look at your work",
    instruction: "Find what you worked on last.",
    startPath: "/my-work",
  },
  {
    id: "hidden",
    title: "Find the hidden page",
    instruction: "Find the page that does not exist.",
    startPath: "/my-work",
  },
];

const seqQuestion = "Overall, how difficult or easy was this task to complete?";

async function startTask(page: Page) {
  const start = page.getByRole("button", { name: "Start task", exact: true });
  await expect(start).toBeEnabled({ timeout: 15_000 });
  await start.click();
}

async function answerSeq(page: Page, value: string, like: string) {
  await expect(page.getByRole("heading", { name: seqQuestion })).toBeVisible({ timeout: 15_000 });
  await page
    .getByRole("radiogroup", { name: seqQuestion })
    .getByRole("radio", { name: value })
    .click();
  await page.getByLabel("What did you like in this task?").fill(like);
  await page.getByLabel("What did you dislike?").fill("");
  await page.getByLabel("What would you recommend?").fill(`recommend ${value}`);
}

const susGroup = (page: Page, index: number) =>
  page.getByTestId("study-sus").getByRole("radiogroup").nth(index);

type StoredSession = {
  participant: string;
  consentAt: number;
  tasks: {
    id: string;
    success: boolean;
    seq: number | null;
    clicks: number;
    durationMs: number;
    notes: Record<string, string>;
    reason: string | null;
  }[];
  final: {
    sus: number[];
    susScore: number;
    open: Record<string, string>;
    changes: { key: string; from: unknown; to: unknown }[];
    finishedAt: number;
  };
};

test("a participant runs consent, two tasks with SEQ and notes, a give-up and the final block with a Back that changes a SUS answer", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.goto("/study/console");
  await page.getByLabel("Task set JSON").fill(JSON.stringify(tasks));
  await page.getByRole("button", { name: "Save tasks" }).click();

  await page.goto("/study");
  await expect(page.getByText("We test the app, not you")).toBeVisible();
  const code = await page.getByTestId("study-code").innerText();
  expect(code).toMatch(/^P-[A-Z2-9]{4}$/);
  await page.getByRole("button", { name: "I agree and start" }).click();

  await expect(page.getByTestId("study-goal-big")).toHaveText(tasks[0]?.instruction ?? "");
  await startTask(page);
  await expect(page.getByTestId("study-goal")).toHaveText(tasks[0]?.instruction ?? "");
  const row = page.getByTestId("slide-row").filter({ hasText: "tumor_044" });
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.click();
  await expect(page.getByTestId("study-review-head")).toHaveText("Task complete", {
    timeout: 15_000,
  });
  await answerSeq(page, "6", "the list was clear");
  await page.getByRole("button", { name: "Next task" }).click();

  await startTask(page);
  await expect(page).toHaveURL(/\/my-work$/);
  await page.getByRole("button", { name: "I'm done" }).click();
  await answerSeq(page, "4", "short");
  await page.getByRole("button", { name: "Next task" }).click();

  await startTask(page);
  await expect(page).toHaveURL(/\/my-work$/);
  await expect(page.getByRole("button", { name: "I can't find it" })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("button", { name: "I can't find it" }).click();
  await expect(page.getByRole("dialog", { name: "What got in the way?" })).toBeVisible();
  await page.getByRole("radio", { name: "I did not know where to look" }).click();
  await page.getByRole("button", { name: /Continue/ }).click();
  await expect(page.getByTestId("study-review-head")).toHaveText("Thank you for telling us");
  await page
    .getByRole("radiogroup", { name: seqQuestion })
    .getByRole("radio", { name: "2" })
    .click();
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(
    page.getByText("I think that I would like to use this system frequently."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Please answer statement 1, 2");
  for (let index = 0; index < 10; index += 1) {
    await susGroup(page, index).getByRole("radio", { name: "4" }).click();
  }
  await page.getByRole("button", { name: "Next", exact: true }).click();

  await expect(page.getByRole("heading", { name: "What did you like?" })).toBeVisible();
  await page.getByRole("textbox").fill("the slide list");
  await page.getByRole("button", { name: "Back" }).click();
  await expect(susGroup(page, 0).getByRole("radio", { name: "4" })).toBeChecked();
  await susGroup(page, 0).getByRole("radio", { name: "5" }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();

  await expect(page.getByRole("textbox")).toHaveValue("the slide list");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByRole("heading", { name: "What did you dislike?" })).toBeVisible();
  await page.getByRole("textbox").fill("the hidden page");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Was there anything you expected to find but could not?" }),
  ).toBeVisible();
  await page.getByRole("textbox").fill("a search box");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByRole("heading", { name: "What would you recommend?" })).toBeVisible();
  await page.getByRole("textbox").fill("more hints");
  await page.getByRole("button", { name: "Finish" }).click();
  await expect(page.getByRole("heading", { name: "Thank you!" })).toBeVisible();

  const stored = await page.evaluate(() => localStorage.getItem("parfocal.study"));
  const sessions = (JSON.parse(stored ?? "{}") as { sessions: StoredSession[] }).sessions;
  const session = sessions.find((entry) => entry.participant === code);
  expect(session?.consentAt).toEqual(expect.any(Number));
  expect(session?.tasks.map((record) => [record.id, record.success, record.seq])).toEqual([
    ["open", true, 6],
    ["look", true, 4],
    ["hidden", false, 2],
  ]);
  for (const record of session?.tasks ?? []) {
    expect(Object.keys(record)).toEqual(
      expect.arrayContaining([
        "durationMs",
        "clicks",
        "deadClicks",
        "blocked",
        "keys",
        "wheels",
        "seq",
        "notes",
      ]),
    );
    expect(record.durationMs).toEqual(expect.any(Number));
  }
  expect(session?.tasks[0]?.clicks).toBeGreaterThan(0);
  expect(session?.tasks[0]?.notes).toEqual({
    like: "the list was clear",
    recommend: "recommend 6",
  });
  expect(session?.tasks[2]?.reason).toBe("where-to-look");
  expect(session?.tasks[2]?.durationMs).toBeGreaterThanOrEqual(20_000);
  expect(session?.final.sus).toEqual([5, 4, 4, 4, 4, 4, 4, 4, 4, 4]);
  expect(session?.final.susScore).toBe(52.5);
  expect(session?.final.open).toEqual({
    like: "the slide list",
    dislike: "the hidden page",
    missing: "a search box",
    recommend: "more hints",
  });
  expect(session?.final.changes).toEqual([
    expect.objectContaining({ key: "sus1", from: 4, to: 5 }),
  ]);
  expect(session?.final.finishedAt).toEqual(expect.any(Number));
});
