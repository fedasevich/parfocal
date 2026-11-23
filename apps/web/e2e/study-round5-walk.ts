import { expect, type Locator, type Page, test } from "@playwright/test";
import { round5Tasks } from "../src/study/study-model.ts";

export const studyRequester = "Dr. Jana Horáková, surgery";

export type WalkPlaces = {
  code: string;
  reviewSlideLink: (page: Page) => Locator;
  secondSlide: RegExp;
};

const seqQuestion = "Overall, how difficult or easy was this task to complete?";

export const presetRun = (page: Page, code: string) =>
  page.addInitScript((participant) => {
    if (window.sessionStorage.getItem("parfocal.study.run") === null) {
      window.sessionStorage.setItem(
        "parfocal.study.run",
        JSON.stringify({ code: participant, phase: "consent", index: 0, finalStep: 0 }),
      );
    }
  }, code);

async function startTask(page: Page, index: number) {
  const task = round5Tasks[index];
  await expect(page.getByTestId("study-goal-big")).toHaveText(task?.instruction ?? "", {
    timeout: 15_000,
  });
  const start = page.getByRole("button", { name: "Start task", exact: true });
  await expect(start).toBeEnabled({ timeout: 15_000 });
  await start.click();
  await expect(page.getByTestId("study-goal")).toHaveText(task?.instruction ?? "");
}

const stageReady = (page: Page) =>
  expect(page.getByTestId("slide-stage").first()).toHaveAttribute("data-state", "ready", {
    timeout: 45_000,
  });

async function finish(page: Page, how: "auto" | "done") {
  if (how === "done") await page.getByRole("button", { name: "I'm done" }).click();
  else {
    await expect(page.getByTestId("study-review-head")).toHaveText("Task complete", {
      timeout: 15_000,
    });
  }
  await expect(page.getByRole("heading", { name: seqQuestion })).toBeVisible({ timeout: 15_000 });
  await page
    .getByRole("radiogroup", { name: seqQuestion })
    .getByRole("radio", { name: "5" })
    .click();
  await page.getByRole("button", { name: /^(Next task|Continue)$/ }).click();
}

const picker = (page: Page) => page.getByTestId("slide-picker");
const card = (page: Page) => page.getByTestId("object-foot");
const firstOpen = (page: Page) => page.getByRole("button", { name: /, the first open object$/ });

async function openFirstOpen(page: Page, kind = ""): Promise<string> {
  await page.getByTestId("stage-inspector").getByRole("tab", { name: "Objects" }).click();
  const goTo = firstOpen(page);
  const object = /^Go to (\S+),/.exec((await goTo.textContent()) ?? "")?.[1] ?? "";
  expect(object).toContain(kind);
  await goTo.click();
  await expect(card(page)).toHaveAttribute("data-object", object);
  return object;
}

async function answerFirstOpen(page: Page) {
  const object = await openFirstOpen(page);
  if (object.includes("·C")) {
    await page.getByTestId("cell-type-bar").getByRole("button", { name: /Agree/ }).click();
  } else {
    await card(page).locator('button[data-counts-as="agree"]').click();
  }
  await card(page).getByRole("button", { name: "Close" }).click();
}

async function answerEveryOpenObject(page: Page) {
  await page.getByTestId("stage-inspector").getByRole("tab", { name: "Objects" }).click();
  for (let step = 0; step < 300 && (await firstOpen(page).count()) > 0; step += 1) {
    await answerFirstOpen(page);
  }
}

const corners = [
  [520, 250],
  [700, 270],
  [680, 420],
  [540, 400],
] as const;

const steps: ((page: Page, places: WalkPlaces) => Promise<void>)[] = [
  async (page, places) => {
    await places.reviewSlideLink(page).first().click();
    await finish(page, "auto");
  },
  async (page) => {
    await stageReady(page);
    await picker(page).click();
    await expect(page.getByRole("dialog", { name: /^Slides in this case/ })).toContainText(
      `Requested by ${studyRequester}`,
    );
    await page.keyboard.press("Escape");
    await finish(page, "done");
  },
  async (page) => {
    await stageReady(page);
    const first = await openFirstOpen(page);
    await expect(card(page)).toHaveAttribute("data-object", first);
    await finish(page, "done");
  },
  async (page) => {
    await stageReady(page);
    for (let answered = 0; answered < 4; answered += 1) await answerFirstOpen(page);
    await finish(page, "done");
  },
  async (page) => {
    await stageReady(page);
    await openFirstOpen(page, "·C");
    await page
      .getByTestId("cell-type-bar")
      .getByRole("button", { name: /Immune/ })
      .click();
    await finish(page, "auto");
  },
  async (page) => {
    await stageReady(page);
    await page.getByTestId("progress-trigger").click();
    await page.getByRole("button", { name: "Whole slide" }).click();
    await finish(page, "done");
  },
  async (page, places) => {
    await stageReady(page);
    await picker(page).click();
    await page.getByRole("button", { name: "Compare", exact: true }).click();
    await page
      .getByRole("listbox", { name: "Slide for the right side" })
      .getByRole("option", { name: places.secondSlide })
      .first()
      .click();
    await finish(page, "auto");
  },
  async (page) => {
    await stageReady(page);
    await picker(page).click();
    await page.getByRole("button", { name: "Add slides" }).click();
    await finish(page, "auto");
  },
  async (page) => {
    await stageReady(page);
    await answerEveryOpenObject(page);
    const submit = page.getByTestId("top-submit");
    await expect(submit).toBeEnabled({ timeout: 15_000 });
    await submit.click();
    await expect(page).toHaveURL(/\/submitted/);
    await finish(page, "done");
  },
  async (page) => {
    const decide = page.getByRole("complementary", { name: "Decide" });
    await page.getByRole("button", { name: /^T\d/ }).first().click();
    await decide.getByRole("button", { name: /Disagree/ }).click();
    await expect(page.getByText("1 resolved")).toBeVisible();
    await finish(page, "done");
  },
  async (page) => {
    const stage = page.getByTestId("slide-stage").first();
    await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 45_000 });
    const box = (await stage.boundingBox()) ?? { x: 0, y: 0 };
    await page.keyboard.press("p");
    for (const [x, y] of corners) await page.mouse.click(box.x + x, box.y + y);
    await page.mouse.click(box.x + corners[0][0] + 2, box.y + corners[0][1] + 1);
    await expect(page.getByTestId("polygon-shape")).toHaveCount(1);
    await expect(stage).toHaveAttribute("data-save-state", "saved");
    await finish(page, "done");
  },
];

export async function walkRound5(page: Page, places: WalkPlaces) {
  await page.goto("/study");
  await expect(page.getByTestId("study-code")).toHaveText(places.code);
  await page.getByRole("button", { name: "I agree and start" }).click();
  for (const [index, task] of round5Tasks.entries()) {
    const step = steps[index];
    if (step === undefined) throw new Error(`no walk step for ${task.id}`);
    await test.step(task.id, async () => {
      await startTask(page, index);
      await step(page, places);
    });
  }
  await expect(
    page.getByText("I think that I would like to use this system frequently."),
  ).toBeVisible();
}
