import { expect, type Locator, type Page, test } from "@playwright/test";

const p07 = "00000000-0000-4000-8003-000000000007";
const byHand = "00000000-0000-4000-8005-000000000014";

test.use({ viewport: { width: 1440, height: 900 } });

async function openAs(page: Page, persona: string) {
  await page.goto(`/projects/${p07}/slides/${byHand}/live?as=${persona}`);
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
    timeout: 20_000,
  });
  return page.getByTestId("slide-host");
}

async function offsetIn(host: Locator, mark: Locator) {
  const box = await host.boundingBox();
  const at = await mark.boundingBox();
  if (box === null || at === null) return null;
  return { x: Math.round(at.x - box.x), y: Math.round(at.y - box.y) };
}

const near = (a: { x: number; y: number } | null, b: { x: number; y: number }) =>
  a !== null && Math.abs(a.x - b.x) <= 2 && Math.abs(a.y - b.y) <= 2;

test("a follower sees the sharer's cursor on the same point of the slide until it leaves", async ({
  context,
}) => {
  test.setTimeout(90_000);
  const lenka = await context.newPage();
  const anna = await context.newPage();
  const lenkaHost = await openAs(lenka, "LM");
  const annaHost = await openAs(anna, "AK");
  await expect(lenka.getByTestId("presence")).toHaveCount(1, { timeout: 5000 });
  const mark = lenka.getByTestId("shared-cursor");

  await anna.bringToFront();
  const stage = await annaHost.boundingBox();
  if (stage === null) throw new Error("no stage");
  await anna.mouse.move(stage.x + 400, stage.y + 300);
  await anna.waitForTimeout(200);
  await expect(mark).toHaveCount(0);

  await anna.getByTestId("share-view").click();
  await anna.mouse.move(stage.x + 420, stage.y + 310);
  const follow = lenka.getByTestId("follow-view");
  await expect(follow).toHaveText("Follow Anna", { timeout: 2000 });
  await expect(mark).toHaveCount(0);
  await follow.click();
  await expect(follow).toHaveText("Following Anna");
  await expect
    .poll(async () => near(await offsetIn(lenkaHost, mark), { x: 420, y: 310 }), { timeout: 5000 })
    .toBe(true);
  await expect(mark).toHaveAttribute("aria-label", /^Anna .* points here$/);

  await anna.mouse.move(stage.x + 640, stage.y + 480, { steps: 12 });
  await expect
    .poll(async () => near(await offsetIn(lenkaHost, mark), { x: 640, y: 480 }), { timeout: 2000 })
    .toBe(true);

  await anna.mouse.wheel(0, -300);
  await expect
    .poll(async () => near(await offsetIn(lenkaHost, mark), { x: 640, y: 480 }), { timeout: 5000 })
    .toBe(true);
  await expect(follow).toHaveText("Following Anna");

  const annaStage = await anna.getByTestId("slide-stage").boundingBox();
  if (annaStage === null) throw new Error("no stage");
  await anna.mouse.move(annaStage.x + annaStage.width / 2, Math.max(annaStage.y - 20, 2));
  await expect(mark).toHaveCount(0, { timeout: 2000 });

  await anna.mouse.move(stage.x + 500, stage.y + 400);
  await expect(mark).toHaveCount(1, { timeout: 2000 });
  await anna.getByTestId("share-view").click();
  await expect(mark).toHaveCount(0, { timeout: 2000 });
});
