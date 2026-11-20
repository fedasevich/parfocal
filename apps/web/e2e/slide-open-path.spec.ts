import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const a1 = "00000000-0000-4000-8005-000000000001";
const live = `/projects/${p07}/slides/${a1}?as=DH`;
const roundTripMs = 150;

test.use({ viewport: { width: 1440, height: 900 } });

type Timed = { url: string; start: number; end: number | null };

function watchRequests(page: Page, origin: () => number) {
  const timed = new Map<object, Timed>();
  page.on("request", (request) => {
    timed.set(request, { url: request.url(), start: Date.now() - origin(), end: null });
  });
  const finish = (request: object) => {
    const entry = timed.get(request);
    if (entry !== undefined && entry.end === null) entry.end = Date.now() - origin();
  };
  page.on("requestfinished", finish);
  page.on("requestfailed", finish);
  return () => [...timed.values()];
}

const firstOf = (entries: Timed[], part: string) => entries.find((item) => item.url.includes(part));

test("tile access and the session check start before the viewer code arrives on a slow network", async ({
  page,
}) => {
  const session = await page.context().newCDPSession(page);
  await session.send("Network.enable");
  await session.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: roundTripMs,
    downloadThroughput: (20 * 1024 * 1024) / 8,
    uploadThroughput: (5 * 1024 * 1024) / 8,
  });
  let navigatedAt = 0;
  const requests = watchRequests(page, () => navigatedAt);
  navigatedAt = Date.now();
  await page.goto(live);
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  const ready = Date.now() - navigatedAt;
  const entries = requests();
  const grant = firstOf(entries, "/tile-access");
  const engine = firstOf(entries, "/viewer-engine");
  const me = firstOf(entries, "/api/me");
  const levels = firstOf(entries, "levels.json");
  console.log(JSON.stringify({ roundTripMs, grant, engine, me, levels, ready }));
  expect(engine?.end ?? null).not.toBeNull();
  const engineEnd = engine?.end ?? 0;
  expect(grant?.start ?? Number.POSITIVE_INFINITY).toBeLessThan(engineEnd);
  expect(me?.start ?? Number.POSITIVE_INFINITY).toBeLessThan(engineEnd);

  await page.getByRole("tab", { name: "Comments" }).click();
  await expect(page).toHaveURL(/tab=comments/);
  await expect(stage).toHaveAttribute("data-state", "ready");
  expect(requests().filter((item) => item.url.includes("/tile-access"))).toHaveLength(1);
});
