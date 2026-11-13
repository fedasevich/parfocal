import { expect, type Locator, type Page, test } from "@playwright/test";

const p07 = "00000000-0000-4000-8003-000000000007";
const annotateTask = "00000000-0000-4000-8007-000000000021";
const byHand = "00000000-0000-4000-8005-000000000014";
const budgetMs = 300;

test.use({ viewport: { width: 1440, height: 900 } });

type Sample = { at: number; camera: string };

async function openAs(page: Page, persona: string) {
  await page.goto(`/projects/${p07}/slides/${byHand}/live?task=${annotateTask}&as=${persona}`);
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 20_000 });
  await page.getByTestId("slide-host").evaluate((host) => {
    const samples: Sample[] = [];
    const record = () => samples.push({ at: Date.now(), camera: host.dataset["camera"] ?? "" });
    new MutationObserver(record).observe(host, {
      attributes: true,
      attributeFilter: ["data-camera"],
    });
    (window as unknown as { cameraSamples: Sample[] }).cameraSamples = samples;
  });
  return page.getByTestId("slide-host");
}

const samplesOf = (page: Page) =>
  page.evaluate(() => (window as unknown as { cameraSamples: Sample[] }).cameraSamples);

const cameraOf = (host: Locator) => host.getAttribute("data-camera");

async function settled(host: Locator) {
  const first = await cameraOf(host);
  await host.page().waitForTimeout(250);
  return first === (await cameraOf(host));
}

async function inStep(follower: Locator, leader: Locator) {
  return (await settled(leader)) && (await cameraOf(follower)) === (await cameraOf(leader));
}

async function drag(page: Page, host: Locator, dx: number, dy: number) {
  const box = (await host.boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 8 });
  await page.mouse.up();
}

test("a follower's camera tracks the shared view within 300 ms until the follower moves", async ({
  context,
}) => {
  test.setTimeout(90_000);
  const lenka = await context.newPage();
  const anna = await context.newPage();
  const lenkaHost = await openAs(lenka, "LM");
  const annaHost = await openAs(anna, "AK");
  await expect(lenka.getByTestId("presence")).toHaveCount(1, { timeout: 5000 });
  await expect(lenka.getByTestId("follow-view")).toHaveCount(0);

  await anna.bringToFront();
  await anna.mouse.move(700, 450);
  await anna.mouse.wheel(0, -600);
  await expect.poll(() => cameraOf(annaHost)).not.toBe(await cameraOf(lenkaHost));
  await anna.getByTestId("share-view").click();
  await expect(anna.getByTestId("share-view")).toHaveAttribute("aria-pressed", "true");

  const follow = lenka.getByTestId("follow-view");
  await expect(follow).toHaveText("Follow Anna", { timeout: 2000 });
  await follow.click();
  await expect(follow).toHaveText("Following Anna");
  await expect.poll(() => inStep(lenkaHost, annaHost), { timeout: 5000 }).toBe(true);

  const before = await cameraOf(annaHost);
  await drag(anna, annaHost, -220, -140);
  await anna.mouse.wheel(0, -300);
  await expect.poll(() => cameraOf(annaHost)).not.toBe(before);
  await expect.poll(() => inStep(lenkaHost, annaHost), { timeout: 5000 }).toBe(true);
  const led = await samplesOf(anna);
  const followed = await samplesOf(lenka);
  const moves = led.filter((sample) => sample.at > (led[0]?.at ?? 0));
  expect(moves.length).toBeGreaterThan(3);
  const lags = moves.flatMap((move) => {
    const arrival = followed.find((sample) => sample.camera === move.camera);
    return arrival === undefined ? [] : [arrival.at - move.at];
  });
  expect(lags.length).toBeGreaterThan(3);
  expect(Math.max(...lags)).toBeLessThan(budgetMs);
  const last = led.at(-1);
  const landed = followed.find((sample) => sample.camera === last?.camera);
  expect((landed?.at ?? Number.POSITIVE_INFINITY) - (last?.at ?? 0)).toBeLessThan(budgetMs);

  await lenka.bringToFront();
  await lenka.mouse.move(700, 450);
  await lenka.mouse.wheel(0, 400);
  await expect(follow).toHaveText("Follow Anna");
  await expect.poll(() => settled(lenkaHost)).toBe(true);
  const mine = await cameraOf(lenkaHost);
  const hers = await cameraOf(annaHost);
  expect(mine).not.toBe(hers);
  await anna.bringToFront();
  await anna.mouse.move(700, 450);
  await anna.mouse.wheel(0, -300);
  await expect.poll(() => cameraOf(annaHost)).not.toBe(hers);
  await lenka.waitForTimeout(400);
  expect(await cameraOf(lenkaHost)).toBe(mine);

  await anna.getByTestId("share-view").click();
  await expect(follow).toHaveCount(0, { timeout: 2000 });
});
