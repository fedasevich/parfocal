import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "./a11y.ts";

test.use({ viewport: { width: 1280, height: 900 } });

const fakeStoreKey = "parfocal.fake.study-runs";
const secret = "Jane Doe 1970-01-01";
const seqQuestion = "Overall, how difficult or easy was this task to complete?";

const tasks = [
  {
    id: "open",
    title: "Open the slide",
    instruction: "Open the tumor_044 slide from the list.",
    slide: "tumor_044",
    startPath: "/projects/{project}?tab=slides",
    firstClick: '[data-testid="slide-row"]',
    check: { path: "/slides/{slide}(\\?|$)" },
  },
  {
    id: "zoom",
    title: "Zoom into the slide",
    instruction: "Zoom into the middle of the slide.",
    slide: "tumor_044",
    startPath: "/projects/{project}/slides/{slide}",
  },
];

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
}

async function finishFinalBlock(page: Page) {
  for (let index = 0; index < 10; index += 1) {
    await page
      .getByTestId("study-sus")
      .getByRole("radiogroup")
      .nth(index)
      .getByRole("radio", { name: index % 2 === 0 ? "5" : "1" })
      .click();
  }
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("textbox").fill("the zoom");
  for (let step = 0; step < 3; step += 1) {
    await page.getByRole("button", { name: "Next", exact: true }).click();
  }
  await page.getByRole("button", { name: "Finish" }).click();
  await expect(page.getByRole("heading", { name: "Thank you!" })).toBeVisible();
}

const uploadedTraceText = (page: Page) =>
  page.evaluate(async (key) => {
    const store = JSON.parse(localStorage.getItem(key) ?? "{}") as {
      parts?: Record<string, { events_gz: string }[]>;
    };
    const texts = await Promise.all(
      Object.values(store.parts ?? {})
        .flat()
        .map(async (part) => {
          const bytes = Uint8Array.from(atob(part.events_gz), (char) => char.charCodeAt(0));
          const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
          return new Response(stream).text();
        }),
    );
    return texts.join("\n");
  }, fakeStoreKey);

async function downloadedCsv(page: Page): Promise<string[]> {
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  const path = await (await download).path();
  return (await readFile(path, "utf8")).trimEnd().split("\n");
}

test("a session recorded in one browser uploads and replays with camera moves in another", async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000);
  test.info().annotations.push({
    type: "skip-axe",
    description: "axe cannot enter the sandboxed replay frame",
  });
  await page.goto("/study/console");
  await page.getByLabel("Task set JSON").fill(JSON.stringify(tasks));
  await page.getByRole("button", { name: "Save tasks" }).click();

  await page.goto("/study");
  const code = await page.getByTestId("study-code").innerText();
  await page.getByRole("button", { name: "I agree and start" }).click();

  await startTask(page);
  const row = page.getByTestId("slide-row").filter({ hasText: "tumor_044" });
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.click();
  await answerSeq(page, "6", "the list was clear");
  await page.getByRole("button", { name: "Next task" }).click();

  await startTask(page);
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  await page.evaluate(() => {
    document.body.insertAdjacentHTML(
      "beforeend",
      '<input id="e2e-name" type="text" aria-label="Probe" value="" />',
    );
  });
  await page.locator("#e2e-name").pressSequentially(secret);
  await page.locator("#e2e-name").evaluate((element) => element.remove());
  const box = await stage.boundingBox();
  if (box === null) throw new Error("The slide stage has no box");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let step = 0; step < 4; step += 1) {
    await page.mouse.wheel(0, -300);
    await page.waitForTimeout(400);
  }
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 150, box.y + box.height / 2 - 80, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "I'm done" }).click();
  await answerSeq(page, "5", "zooming felt smooth");
  await page.getByRole("button", { name: "Continue" }).click();
  await finishFinalBlock(page);
  await expect(page.getByTestId("study-participant")).toHaveAttribute("data-upload", "synced", {
    timeout: 30_000,
  });

  const traceText = await uploadedTraceText(page);
  expect(traceText).toContain('"k":"camera"');
  expect(traceText).not.toContain("Jane");
  expect(traceText).not.toContain("1970");
  const uploaded = await page.evaluate((key) => localStorage.getItem(key), fakeStoreKey);
  expect(uploaded).toBeTruthy();

  const other = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await other.addInitScript(
    ([key, value]) => {
      if (sessionStorage.getItem("e2e-seeded") !== null) return;
      sessionStorage.setItem("e2e-seeded", "1");
      localStorage.setItem(key, value);
    },
    [fakeStoreKey, uploaded ?? ""] as const,
  );
  const moderator = await other.newPage();
  await moderator.goto("/study/console");
  expect(await moderator.evaluate(() => localStorage.getItem("parfocal.study"))).toBeNull();

  const result = moderator.getByTestId(`study-result-${code}`);
  await expect(result).toBeVisible({ timeout: 30_000 });
  await expect(moderator.getByTestId("study-results-count")).toContainText(
    "1 sessions counted, 0 dry runs left out",
  );
  await expect(moderator.getByTestId("study-results-tasks-row")).toHaveCount(2);
  await expect(moderator.getByTestId("study-results-participants-row")).toContainText(code);
  await expect(moderator.getByTestId("study-results-sus-mean")).toHaveText("Mean 100.0");
  await expect(moderator.getByTestId("notes-open")).toContainText("the list was clear");
  await expect(moderator.getByTestId("study-results-final")).toContainText("the zoom");
  await expect(moderator.getByTestId("compare-completed").getByTestId("round-four")).toHaveText(
    "40 of 40",
  );
  await expect(moderator.getByTestId("compare-completed").getByTestId("this-round")).toHaveText(
    "2 of 2",
  );

  await result.getByRole("button", { name: "Replay" }).click();
  await expect(moderator.getByTestId("replay-panel")).toBeVisible();
  const slider = moderator.getByLabel("Replay position");
  const end = Number(await slider.getAttribute("max"));
  const cameras = new Set<string>();
  for (let step = 0; step <= 40; step += 1) {
    await slider.fill(String(Math.round((end * step) / 40)));
    const camera = moderator.getByTestId("replay-camera");
    if ((await camera.count()) > 0) cameras.add((await camera.getAttribute("data-camera")) ?? "");
  }
  expect(cameras.size).toBeGreaterThanOrEqual(2);
  await expect(moderator.getByTestId("replay-camera-box")).toBeVisible();

  const csv = await downloadedCsv(moderator);
  expect(csv).toHaveLength(3);
  expect(csv[0]).toContain("participant,session,round,task");
  expect(csv[1]).toContain(`${code},`);
  expect(csv[1]).toContain(",open,");
  expect(csv[2]).toContain(",zoom,");

  await result.getByRole("checkbox", { name: "Dry run" }).click();
  await expect(moderator.getByTestId("study-results-count")).toContainText(
    "0 sessions counted, 1 dry runs left out",
  );
  await expect(result).toHaveAttribute("data-dry-run", "true");
  await expect(moderator.getByTestId("study-results-tasks-row")).toHaveCount(0);
  expect(await downloadedCsv(moderator)).toHaveLength(1);
  await other.close();
});
