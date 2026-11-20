import { expect, type Page, test } from "./a11y.ts";

test.use({ viewport: { width: 1280, height: 900 } });

const secret = "Jane Doe 1970-01-01";

const startTask = (page: Page) => page.getByRole("button", { name: "Start task" }).click();

async function startSessionFor(page: Page, participant: string) {
  await page.getByLabel("Participant code").fill(participant);
  await page.getByRole("button", { name: "Start session" }).click();
}

const stageReady = (task: Page) =>
  expect(task.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
    timeout: 30_000,
  });

async function openFirstTaskSlide(page: Page) {
  const popup = page.waitForEvent("popup");
  await startTask(page);
  const task = await popup;
  await task.getByTestId("slide-row").filter({ hasText: "tumor_044" }).click();
  await expect(page.getByTestId("study-task-card")).toContainText("2/10", { timeout: 30_000 });
  return task;
}

const storedTrace = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<string>((resolve, reject) => {
        const open = indexedDB.open("parfocal-study-trace", 1);
        open.onerror = () => reject(new Error("The trace store did not open"));
        open.onsuccess = () => {
          const request = open.result
            .transaction("batches", "readonly")
            .objectStore("batches")
            .getAll();
          request.onsuccess = () => resolve(JSON.stringify(request.result));
          request.onerror = () => reject(new Error("The trace store did not read"));
        };
      }),
  );

test("a scripted session is recorded with masked text and replays with task jumps", async ({
  page,
}) => {
  test.setTimeout(180_000);
  test.info().annotations.push({
    type: "skip-axe",
    description: "axe cannot enter the sandboxed replay frame",
  });
  await page.goto("/study");
  await expect(page.getByTestId("study-recorder-warning")).toHaveCount(0);
  await startSessionFor(page, "P1");
  const task = await openFirstTaskSlide(page);

  await startTask(page);
  await stageReady(task);
  await task.evaluate((value) => {
    document.body.insertAdjacentHTML(
      "beforeend",
      `<div id="e2e-probe"><input id="e2e-name" type="text" value="${value}" /><button id="e2e-dead" type="button">Nothing</button></div>`,
    );
  }, secret);
  await task.locator("#e2e-name").pressSequentially(secret);
  await task.locator("#e2e-dead").click();
  await task.waitForTimeout(1500);
  await task.reload();
  await stageReady(task);
  await task.keyboard.press("g");
  await task.keyboard.press("2");
  await expect(page.getByTestId("study-task-card")).toContainText("3/10", { timeout: 30_000 });
  await page.getByRole("button", { name: "Start task" }).click();
  await task.waitForTimeout(1500);

  const stored = await storedTrace(page);
  expect(stored).not.toContain("Jane");
  expect(stored).not.toContain("1970");
  expect(stored).toContain("•");
  expect(stored).toContain('"k":"frame"');

  await page.locator('[data-testid^="study-replay-"]').first().click();
  await expect(page.getByTestId("replay-panel")).toBeVisible();
  await expect(page.getByTestId("replay-stage")).toHaveAttribute("data-mode", "screen");
  await expect(page.getByTestId("replay-chip-t1")).toBeVisible();
  await expect(page.getByTestId("replay-chip-t2")).toBeVisible();
  await expect(page.getByTestId("replay-span-t2")).toBeVisible();
  await expect(page.getByTestId("replay-strip")).toHaveAttribute("data-reloads", "1");
  await expect(page.getByTestId("replay-strip")).not.toHaveAttribute("data-dead-clicks", "0");

  const srcdoc = await page.getByTitle("Replay screen").getAttribute("srcdoc");
  expect(srcdoc ?? "").not.toContain("Jane");

  await page.getByTestId("replay-chip-t2").click();
  const atT2 = await page.getByTestId("replay-time").innerText();
  await page.getByTestId("replay-chip-t1").click();
  const atT1 = await page.getByTestId("replay-time").innerText();
  expect(atT1.startsWith("0s")).toBe(true);
  expect(atT2).not.toEqual(atT1);

  await page.getByLabel("Replay position").fill(String(await replayEnd(page)));
  await expect(page.getByTestId("replay-stage")).toHaveAttribute(
    "data-path",
    /\/slides\/[^/?]+(\?|$)/,
  );
});

async function replayEnd(page: Page): Promise<number> {
  return Number(await page.getByLabel("Replay position").getAttribute("max"));
}

test("a blocked recorder warns on the start screen and the replay falls back to pointer only", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const devtools = await page.context().newCDPSession(page);
  await devtools.send("Network.enable");
  await devtools.send("Network.setBlockedURLs", { urls: ["*dom-frames*"] });
  await page.goto("/study");
  await expect(page.getByTestId("study-recorder-warning")).toBeVisible();
  await startSessionFor(page, "P1");
  const task = await openFirstTaskSlide(page);
  await task.waitForTimeout(500);

  const stored = await storedTrace(page);
  expect(stored).not.toContain('"k":"frame"');
  expect(stored).toContain('"k":"click"');

  await page.locator('[data-testid^="study-replay-"]').first().click();
  await expect(page.getByTestId("replay-stage")).toHaveAttribute("data-mode", "pointer-only");
  await expect(page.getByTestId("replay-wireframe")).toBeVisible();
  await expect(page.getByTestId("replay-chip-t1")).toBeVisible();
  await page.getByLabel("Replay position").fill(String(await replayEnd(page)));
  await expect(page.getByTestId("replay-cursor")).toBeVisible();
  await expect(page.getByTestId("replay-stage")).toHaveAttribute("data-path", /.+/);
});
