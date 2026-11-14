import { expect, type Locator, type Page, test } from "@playwright/test";

const p07 = "00000000-0000-4000-8003-000000000007";
const byHand = "00000000-0000-4000-8005-000000000014";
const blindedTask = "00000000-0000-4000-8007-000000000014";
const comparedSlide = "00000000-0000-4000-8005-000000000001";

test.use({ viewport: { width: 1440, height: 900 } });

async function openAs(page: Page, persona: string, slide = byHand) {
  await page.goto(`/projects/${p07}/slides/${slide}/live?as=${persona}`);
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

const readsForward = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-slot="cursor-name"]')].map((label) => {
      let facing = 1;
      for (let node: Element | null = label; node !== null; node = node.parentElement) {
        const { transform } = getComputedStyle(node);
        if (transform !== "none") facing *= Math.sign(new DOMMatrixReadOnly(transform).a);
      }
      return facing;
    }),
  );

test("a sharer's cursor shows in a compare pane and a compare user's cursor reaches a follower", async ({
  context,
}) => {
  test.setTimeout(120_000);
  const anna = await context.newPage();
  const jan = await context.newPage();
  const simona = await context.newPage();
  const annaHost = await openAs(anna, "AK", comparedSlide);
  const janHost = await openAs(jan, "JR", comparedSlide);
  await simona.goto(
    `/projects/${p07}/slides/${comparedSlide}?task=${blindedTask}&scene=picked&as=SM`,
  );
  const lenka = await context.newPage();
  await lenka.goto(
    `/projects/${p07}/slides/${comparedSlide}?task=${blindedTask}&scene=picked&as=LM`,
  );
  const home = simona.locator('[data-pane="left"]');
  await expect(home).toBeVisible({ timeout: 20_000 });
  await expect(simona.getByTestId("presence")).toHaveCount(1, { timeout: 5000 });
  await expect(lenka.locator('[data-pane="left"]')).toBeVisible({ timeout: 20_000 });
  await expect(anna.getByTestId("presence")).toHaveAttribute(
    "aria-label",
    /Simona Marková.*Lenka Malá|Lenka Malá.*Simona Marková/,
    { timeout: 5000 },
  );
  await expect(lenka.getByTestId("presence")).toHaveCount(1);
  await expect(simona.getByTestId("share-view")).toHaveCount(0);

  await anna.bringToFront();
  const stage = await annaHost.boundingBox();
  if (stage === null) throw new Error("no stage");
  const pointed = { x: Math.round(stage.width / 2), y: Math.round(stage.height / 2) };
  await anna.getByTestId("share-view").click();
  await anna.mouse.move(stage.x + pointed.x - 20, stage.y + pointed.y - 10);
  await anna.mouse.move(stage.x + pointed.x, stage.y + pointed.y);
  const follow = jan.getByTestId("follow-view");
  await expect(follow).toHaveText("Follow Anna", { timeout: 2000 });
  await follow.click();
  await expect(follow).toHaveText("Following Anna");

  const inPane = home.getByTestId("shared-cursor");
  await expect(inPane).toHaveCount(1, { timeout: 5000 });
  await expect(inPane).toHaveAttribute("aria-label", /^Anna .* points here$/);
  await expect(simona.getByTestId("shared-cursor")).toHaveCount(2);
  const flipped = simona.locator('[data-pane] > div[style*="scaleX(-1)"]');
  const change = simona.locator('[data-pane="right"] button[aria-haspopup="listbox"]');
  const options = simona
    .getByRole("listbox", { name: "Slide for the right side" })
    .getByRole("option");
  await change.click();
  const choices = await options.count();
  await change.click();
  for (let index = 0; index < choices && (await flipped.count()) === 0; index += 1) {
    await change.click();
    const swaps = /swaps the panes/.test((await options.nth(index).textContent()) ?? "");
    await (swaps ? change : options.nth(index)).click();
  }
  await expect(flipped.getByTestId("shared-cursor")).toHaveCount(1);
  expect(await readsForward(simona)).toEqual([1, 1]);

  await simona.bringToFront();
  const share = simona.getByTestId("share-cursor");
  await share.click();
  await expect(share).toHaveAttribute("aria-checked", "true");
  const target = await inPane.boundingBox();
  const pane = await home.boundingBox();
  if (target === null || pane === null) throw new Error("no cursor in the pane");
  expect(target.x).toBeGreaterThan(pane.x);
  expect(target.x).toBeLessThan(pane.x + pane.width);
  expect(target.y).toBeGreaterThan(pane.y);
  expect(target.y).toBeLessThan(pane.y + pane.height);
  await simona.mouse.move(target.x - 30, target.y - 30);
  await simona.mouse.move(target.x, target.y, { steps: 4 });

  const fromCompare = '[data-testid="shared-cursor"]:not([aria-label^="Anna"])';
  for (const [page, host] of [
    [anna, annaHost],
    [jan, janHost],
  ] as const) {
    const mark = page.locator(fromCompare);
    await expect(mark).toHaveCount(1, { timeout: 5000 });
    await expect
      .poll(async () => {
        const at = await offsetIn(host, mark);
        return at !== null && Math.abs(at.x - pointed.x) <= 6 && Math.abs(at.y - pointed.y) <= 6;
      })
      .toBe(true);
  }
  await expect(follow).toHaveText("Following Anna");
  await expect(lenka.getByTestId("share-cursor")).toHaveCount(0);
  await expect(lenka.getByTestId("shared-cursor")).toHaveCount(0);

  await share.click();
  await expect(anna.locator(fromCompare)).toHaveCount(0, { timeout: 2000 });
  await expect(jan.locator(fromCompare)).toHaveCount(0);
});
