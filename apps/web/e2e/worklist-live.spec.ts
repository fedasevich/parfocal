import { expect, test } from "@playwright/test";

const ready = 20_000;

test("a task that arrives in one session shows in another My work within 2 s", async ({
  context,
}) => {
  const watcher = await context.newPage();
  const sender = await context.newPage();
  await watcher.goto("/my-work?tab=review&as=LM");
  await expect(watcher.getByText("Continue reviewing")).toBeVisible({ timeout: ready });
  await sender.goto("/my-work?tab=review&as=LM");
  await expect(sender.getByText("Continue reviewing")).toBeVisible({ timeout: ready });
  await expect(watcher.getByText("Task that arrived live")).toHaveCount(0);
  const user = await watcher.evaluate(async () => {
    const response = await fetch("/api/me");
    return ((await response.json()) as { user_id: string }).user_id;
  });
  await sender.evaluate((id) => {
    const channel = new BroadcastChannel("parfocal-fake-worklist");
    channel.postMessage({ user: id });
    channel.close();
  }, user);
  await expect(watcher.getByText("Task that arrived live")).toBeVisible({ timeout: 2000 });
  await expect(sender.getByText("Task that arrived live")).toBeVisible({ timeout: 2000 });
});
