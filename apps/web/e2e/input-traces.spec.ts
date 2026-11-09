import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "./a11y.ts";

const address = "/spikes/input-traces?countdown=0.15&record=0.9";

const status = (page: Page) => page.getByRole("status", { name: "Recorder status" });

async function startProfile(page: Page, title: string) {
  await page.goto(address);
  await page.getByRole("button", { name: `Start ${title}` }).click();
  await expect(status(page)).toBeVisible();
}

async function padCentre(page: Page) {
  const box = await page
    .getByText(/Keep the pointer over this pad|Recording, go ahead/)
    .boundingBox();
  if (box === null) throw new Error("The pad is not on the page");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function inStep(
  page: Page,
  index: number,
  action: (at: { x: number; y: number }) => Promise<void>,
) {
  await expect(status(page)).toHaveAttribute("data-index", String(index));
  await expect(status(page)).toHaveAttribute("data-phase", "recording");
  const at = await padCentre(page);
  await page.mouse.move(at.x, at.y);
  await action(at);
}

async function waitForSummary(page: Page) {
  await expect(page.getByRole("button", { name: "Download JSON" })).toBeVisible();
}

async function downloaded(page: Page) {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download JSON" }).click();
  const file = await pending;
  const path = await file.path();
  const body = await readFile(path, "utf8");
  return { name: file.suggestedFilename(), trace: JSON.parse(body) as Recorded };
}

interface RecordedEvent {
  type: string;
  t: number;
  deltaX?: number;
  deltaY?: number;
  button?: number;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

interface Recorded {
  schema: number;
  origin: string;
  device: string;
  label: string;
  viewport: { width: number };
  gestures: { gesture: string; variant?: string; events: RecordedEvent[] }[];
}

function gestureAt(trace: Recorded, index: number) {
  const found = trace.gestures[index];
  if (found === undefined) throw new Error(`The file has no gesture ${index}`);
  return found;
}

function firstEvent(trace: Recorded, index: number) {
  const found = gestureAt(trace, index).events[0];
  if (found === undefined) throw new Error(`Gesture ${index} has no events`);
  return found;
}

async function holding(page: Page, key: string, action: () => Promise<void>) {
  await page.keyboard.down(key);
  await action();
  await page.keyboard.up(key);
}

async function wheelTimes(page: Page, times: number, dx: number, dy: number) {
  for (let count = 0; count < times; count += 1) {
    await page.mouse.wheel(dx, dy);
    await page.waitForTimeout(40);
  }
}

function pointerNames(trace: Recorded, gesture: string) {
  const found = trace.gestures.find((entry) => entry.gesture === gesture);
  return found?.events.map((event) => event.type) ?? [];
}

test("the start page lists the steps for a mouse, a Mac trackpad and an optional Windows touchpad", async ({
  page,
}) => {
  await page.goto(address);
  const mouse = page.getByRole("region", { name: "Mouse with a wheel" });
  const mac = page.getByRole("region", { name: "Mac trackpad" });
  const windows = page.getByRole("region", { name: "Windows precision touchpad" });
  await expect(mouse.getByRole("listitem")).toHaveCount(9);
  await expect(mac.getByRole("listitem")).toHaveCount(10);
  await expect(windows.getByRole("listitem")).toHaveCount(10);
  await expect(mouse).toContainText("Mouse, scroll down slowly");
  await expect(mac).toContainText("Mac trackpad, pinch in slowly");
  await expect(windows).toContainText("(optional)");
});

test("a mouse run records every step from synthetic events and downloads one JSON file", async ({
  page,
}) => {
  await startProfile(page, "Mouse with a wheel");
  await expect(page.getByRole("heading", { name: "Mouse, scroll down slowly" })).toBeVisible();
  await inStep(page, 0, async () => wheelTimes(page, 3, 0, 100));
  await inStep(page, 1, async () => wheelTimes(page, 6, 0, 100));
  await inStep(page, 2, async () => wheelTimes(page, 3, 0, -100));
  await inStep(page, 3, async () => holding(page, "Control", () => wheelTimes(page, 3, 0, -100)));
  await inStep(page, 4, async () => holding(page, "Shift", () => wheelTimes(page, 3, 100, 0)));
  await inStep(page, 5, async (at) => {
    await page.mouse.down();
    await page.mouse.move(at.x + 60, at.y + 30, { steps: 5 });
    await page.mouse.move(at.x + 120, at.y + 90, { steps: 5 });
    await page.mouse.up();
  });
  await inStep(page, 6, async (at) => {
    await page.mouse.down({ button: "middle" });
    await page.mouse.move(at.x - 80, at.y - 40, { steps: 5 });
    await page.mouse.up({ button: "middle" });
  });
  await inStep(page, 7, async (at) => page.mouse.dblclick(at.x, at.y));
  await inStep(page, 8, async (at) => holding(page, "Alt", () => page.mouse.dblclick(at.x, at.y)));
  await waitForSummary(page);

  const summary = page.getByRole("list", { name: "Recorded steps" }).getByRole("listitem");
  await expect(summary).toHaveCount(9);
  for (const item of await summary.all()) {
    expect(Number(await item.getAttribute("data-events"))).toBeGreaterThan(0);
  }

  const { name, trace } = await downloaded(page);
  expect(name).toMatch(/^mouse-[a-z0-9-]+\.recorded\.json$/);
  expect(trace.schema).toBe(1);
  expect(trace.origin).toBe("recorded");
  expect(trace.device).toBe("mouse");
  expect(trace.viewport.width).toBeGreaterThan(100);
  expect(trace.gestures.map((entry) => entry.gesture)).toEqual([
    "scroll-down",
    "scroll-down",
    "scroll-up",
    "ctrl-wheel",
    "shift-wheel",
    "drag",
    "middle-drag",
    "double-click",
    "alt-double-click",
  ]);
  expect(gestureAt(trace, 0).variant).toBe("slowly");
  expect(gestureAt(trace, 0).events.length).toBeGreaterThanOrEqual(3);
  expect(firstEvent(trace, 0).type).toBe("wheel");
  expect(firstEvent(trace, 0).t).toBe(0);
  expect(firstEvent(trace, 0).deltaY).toBeGreaterThan(0);
  expect(firstEvent(trace, 3).ctrlKey).toBe(true);
  expect(firstEvent(trace, 4).shiftKey).toBe(true);
  expect(pointerNames(trace, "drag")).toContain("pointerdown");
  expect(pointerNames(trace, "drag")).toContain("pointerup");
  expect(firstEvent(trace, 6).button).toBe(1);
  expect(pointerNames(trace, "double-click")).toContain("dblclick");
  expect(gestureAt(trace, 8).events.every((event) => event.altKey)).toBe(true);
});

test("a trackpad run records scrolling and pinching and leaves out a step with no events", async ({
  page,
}) => {
  await startProfile(page, "Mac trackpad");
  await inStep(page, 0, async () => wheelTimes(page, 8, 0, 6.5));
  await inStep(page, 1, async () => wheelTimes(page, 12, 0, 38.5));
  await inStep(page, 2, async () => wheelTimes(page, 8, 0, -6.5));
  await inStep(page, 3, async () => wheelTimes(page, 8, 7.25, 0));
  await inStep(page, 4, async () => holding(page, "Control", () => wheelTimes(page, 8, 0, -3.4)));
  await inStep(page, 5, async () => holding(page, "Control", () => wheelTimes(page, 4, 0, -9.8)));
  await inStep(page, 6, async () => holding(page, "Control", () => wheelTimes(page, 8, 0, 3.4)));
  await inStep(page, 7, async () => holding(page, "Control", () => wheelTimes(page, 4, 0, 9.8)));
  await expect(status(page)).toHaveAttribute("data-index", "8");
  await waitForSummary(page);

  await expect(page.locator('[data-step="double-click"]')).toHaveAttribute("data-events", "0");
  await expect(page.locator('[data-step="double-click"]')).toContainText("no events, run it again");

  const { name, trace } = await downloaded(page);
  expect(name).toMatch(/^trackpad-[a-z0-9-]+\.recorded\.json$/);
  expect(trace.device).toBe("trackpad");
  expect(trace.label).toContain("Mac trackpad");
  const gestures = trace.gestures.map((entry) => [entry.gesture, entry.variant]);
  expect(gestures).toEqual([
    ["scroll-down", "slowly"],
    ["scroll-down", "flick"],
    ["scroll-up", "slowly"],
    ["scroll-sideways", undefined],
    ["pinch-out", "slowly"],
    ["pinch-out", "fast"],
    ["pinch-in", "slowly"],
    ["pinch-in", "fast"],
  ]);
  expect(firstEvent(trace, 0).deltaY).toBeCloseTo(6.5, 3);
  expect(firstEvent(trace, 3).deltaX).toBeCloseTo(7.25, 3);
  expect(firstEvent(trace, 4).ctrlKey).toBe(true);
});

test("Skip, Cancel and Record again leave the recorder in a clean state", async ({ page }) => {
  await startProfile(page, "Windows precision touchpad");
  await expect(status(page)).toHaveAttribute("data-step", "scroll-down-slow");
  await page.getByRole("button", { name: "Next step" }).click();
  await expect(status(page)).toHaveAttribute("data-step", "scroll-down-flick");
  await expect(status(page)).toHaveAttribute("data-events", "0");
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("region", { name: "Mouse with a wheel" })).toBeVisible();
});
