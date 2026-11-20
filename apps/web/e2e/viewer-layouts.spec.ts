import { expect, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const a1 = "00000000-0000-4000-8005-000000000001";
const rt14 = "00000000-0000-4000-8007-000000000014";

test.use({ viewport: { width: 1440, height: 900 } });

const modes = [
  { mode: "look", task: undefined },
  { mode: "annotate", task: undefined },
  { mode: "review", task: rt14 },
  { mode: "guided", task: rt14 },
  { mode: "annotate", task: rt14 },
] as const;

for (const { mode, task } of modes) {
  test(`focus is a layout of the one viewer in ${mode} mode ${task ? "with" : "without"} a task`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const query = new URLSearchParams({ mode, layout: "focus", ...(task ? { task } : {}) });
    await page.goto(`/projects/${p07}/slides/${a1}?${query}`);
    await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
      timeout: 30_000,
    });
    await expect(page.getByTestId("focus-mode")).toBeVisible();
    await expect(page.getByTestId("live-top-bar")).toHaveCount(0);
    await expect(page.locator('[data-slot="tool-rail"]')).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`mode=${mode}`));

    await page.keyboard.press("Control+Backslash");
    await expect(page.getByTestId("focus-mode")).toHaveCount(0);
    await expect(page.getByTestId("live-top-bar")).toBeVisible();
    await expect(page).not.toHaveURL(/layout=/);
    await expect(page).toHaveURL(new RegExp(`mode=${mode}`));

    await page.keyboard.press("Control+Backslash");
    await expect(page.getByTestId("focus-mode")).toBeVisible();
    await expect(page).toHaveURL(/layout=focus/);
  });
}

test("an old focus address opens the focus layout", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto(`/projects/${p07}/slides/${a1}?task=${rt14}&focus=true`);
  await expect(page).toHaveURL(/layout=focus/);
  await expect(page).not.toHaveURL(/focus=true/);
  await expect(page.getByTestId("focus-mode")).toBeVisible();
});

test("compare works in guided mode from the slide list and keeps guided", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto(`/projects/${p07}/slides/${a1}?task=${rt14}&mode=guided&layout=compare`);
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
    timeout: 30_000,
  });
  await expect(page.locator('[data-pane="right"]')).toBeVisible();
  await expect(page).toHaveURL(/mode=guided/);
  await page.getByRole("button", { name: "Close compare" }).click();
  await expect(page).not.toHaveURL(/layout=/);
  await expect(page.locator('[data-pane="right"]')).toHaveCount(0);
});
