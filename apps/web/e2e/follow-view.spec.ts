import { expect, type Locator, type Page, test } from "@playwright/test";

const p07 = "00000000-0000-4000-8003-000000000007";
const byHand = "00000000-0000-4000-8005-000000000014";
const blindedTask = "00000000-0000-4000-8007-000000000014";
const blindedSlide = "00000000-0000-4000-8005-000000000001";
const budgetMs = 300;
const leaderSteps = 5;

test.use({ viewport: { width: 1024, height: 640 } });

type Sample = { at: number; camera: string };
type Relayed = {
  type?: unknown;
  frame?: { type?: unknown; x?: unknown; y?: unknown; zoom?: unknown };
};
type RelayStamps = { relaySent: Sample[]; relayApplied: Sample[] };

function stampRelayedViews() {
  const stamps: RelayStamps = { relaySent: [], relayApplied: [] };
  Object.assign(window, stamps);
  const viewCameraOf = (data: Relayed) => {
    const frame = data?.frame;
    if (data?.type !== "relay" || frame?.type !== "view") return null;
    const { x, y, zoom } = frame;
    if (typeof x !== "number" || typeof y !== "number" || typeof zoom !== "number") return null;
    return `${x.toFixed(3)},${y.toFixed(3)},${zoom.toFixed(4)}`;
  };
  const Native = window.BroadcastChannel;
  window.BroadcastChannel = class extends Native {
    override postMessage(data: Relayed) {
      const camera = viewCameraOf(data);
      if (camera !== null) stamps.relaySent.push({ at: Date.now(), camera });
      super.postMessage(data);
    }
    override get onmessage() {
      return super.onmessage;
    }
    override set onmessage(handler: ((event: MessageEvent) => void) | null) {
      super.onmessage =
        handler === null
          ? null
          : (event: MessageEvent<Relayed>) => {
              const camera = viewCameraOf(event.data);
              if (camera !== null) stamps.relayApplied.push({ at: Date.now(), camera });
              handler.call(this, event);
            };
    }
  };
}

const stampsOf = (page: Page) =>
  page.evaluate((): RelayStamps => {
    const { relaySent, relayApplied } = window as unknown as RelayStamps;
    return { relaySent, relayApplied };
  });

const firstAt = (samples: Sample[], camera: string) =>
  samples.find((sample) => sample.camera === camera)?.at;

async function openAs(page: Page, persona: string, slide = byHand, task?: string) {
  const inTask = task === undefined ? "" : `task=${task}&`;
  await page.goto(`/projects/${p07}/slides/${slide}/live?${inTask}as=${persona}`);
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

test("a follower's camera tracks the shared view within 300 ms until the follower moves", async ({
  context,
}) => {
  test.setTimeout(90_000);
  await context.addInitScript(stampRelayedViews);
  const lenka = await context.newPage();
  const anna = await context.newPage();
  const lenkaHost = await openAs(lenka, "LM");
  const annaHost = await openAs(anna, "AK");
  await expect(lenka.getByTestId("presence")).toHaveCount(1, { timeout: 5000 });
  await expect(lenka.getByTestId("follow-view")).toHaveCount(0);

  await anna.bringToFront();
  await anna.mouse.move(400, 450);
  await anna.mouse.wheel(0, -600);
  await expect.poll(() => cameraOf(annaHost)).not.toBe(await cameraOf(lenkaHost));
  await anna.getByTestId("share-view").click();
  await expect(anna.getByTestId("share-view")).toHaveAttribute("aria-pressed", "true");

  const follow = lenka.getByTestId("follow-view");
  await expect(follow).toHaveText("Follow Anna", { timeout: 2000 });
  await follow.click();
  await expect(follow).toHaveText("Following Anna");
  await expect.poll(() => inStep(lenkaHost, annaHost), { timeout: 5000 }).toBe(true);

  await lenka.bringToFront();
  const before = await cameraOf(annaHost);
  const leadingFrom = await anna.evaluate(() => Date.now());
  await anna.mouse.move(520, 380);
  for (let step = 0; step < leaderSteps; step += 1) {
    const from = await cameraOf(annaHost);
    await anna.mouse.wheel(0, -100);
    await expect.poll(() => cameraOf(annaHost)).not.toBe(from);
  }
  await expect.poll(() => cameraOf(annaHost)).not.toBe(before);
  await expect.poll(() => inStep(lenkaHost, annaHost), { timeout: 5000 }).toBe(true);
  const led = await samplesOf(anna);
  const followed = await samplesOf(lenka);
  const moves = led.filter((sample) => sample.at > leadingFrom);
  expect(moves.length).toBeGreaterThan(3);
  const { relaySent } = await stampsOf(anna);
  const { relayApplied } = await stampsOf(lenka);
  const legs = moves.flatMap((move) => {
    const shown = firstAt(followed, move.camera);
    const sentAt = firstAt(relaySent, move.camera);
    const appliedAt = firstAt(relayApplied, move.camera);
    if (shown === undefined || sentAt === undefined || appliedAt === undefined) return [];
    return [
      {
        total: shown - move.at,
        changeToSend: sentAt - move.at,
        sendToApply: appliedAt - sentAt,
        applyToShown: shown - appliedAt,
      },
    ];
  });
  expect(legs.length).toBeGreaterThan(3);
  const ownOf = (leg: (typeof legs)[number]) => leg.changeToSend + leg.applyToShown;
  const slowest = legs.reduce((worst, leg) => (ownOf(leg) > ownOf(worst) ? leg : worst));
  expect(ownOf(slowest), `slowest follow step ${JSON.stringify(slowest)}`).toBeLessThan(budgetMs);
  const totals = legs.map((leg) => leg.total).sort((a, b) => a - b);
  const median = totals[Math.floor(totals.length / 2)] ?? Number.POSITIVE_INFINITY;
  expect(median, `follow steps ${JSON.stringify(legs)}`).toBeLessThan(budgetMs);
  const last = led.at(-1);
  expect(followed.some((sample) => sample.camera === last?.camera)).toBe(true);

  await lenka.bringToFront();
  await lenka.mouse.move(400, 450);
  await lenka.mouse.wheel(0, 400);
  await expect(follow).toHaveText("Follow Anna");
  await expect.poll(() => settled(lenkaHost)).toBe(true);
  const mine = await cameraOf(lenkaHost);
  const hers = await cameraOf(annaHost);
  expect(mine).not.toBe(hers);
  await anna.bringToFront();
  await anna.mouse.move(400, 450);
  await anna.mouse.wheel(0, -300);
  await expect.poll(() => cameraOf(annaHost)).not.toBe(hers);
  await lenka.waitForTimeout(400);
  expect(await cameraOf(lenkaHost)).toBe(mine);

  await anna.getByTestId("share-view").click();
  await expect(follow).toHaveCount(0, { timeout: 2000 });
});

test("a reviewer who has not submitted a blinded slide cannot share, follow or see a shared cursor", async ({
  context,
}) => {
  test.setTimeout(90_000);
  const lenka = await context.newPage();
  const simona = await context.newPage();
  await openAs(lenka, "LM", blindedSlide, blindedTask);
  const simonaHost = await openAs(simona, "SM", blindedSlide, blindedTask);
  await expect(lenka.getByTestId("presence")).toHaveCount(1, { timeout: 5000 });
  await expect(simona.getByTestId("presence")).toHaveCount(1, { timeout: 5000 });
  await expect(lenka.getByTestId("share-view")).toHaveCount(0);

  await simona.bringToFront();
  const share = simona.getByTestId("share-view");
  await share.click();
  await expect(share).toHaveAttribute("aria-pressed", "true");
  const stage = await simonaHost.boundingBox();
  if (stage === null) throw new Error("no stage");
  await simona.mouse.move(stage.x + 400, stage.y + 300);
  await simona.mouse.wheel(0, -300);
  await simona.mouse.move(stage.x + 460, stage.y + 340, { steps: 6 });
  await simona.waitForTimeout(600);

  await expect(lenka.getByTestId("presence")).toHaveCount(1);
  await expect(lenka.getByTestId("share-view")).toHaveCount(0);
  await expect(lenka.getByTestId("follow-view")).toHaveCount(0);
  await expect(lenka.getByTestId("shared-cursor")).toHaveCount(0);
});
