import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const a1 = "00000000-0000-4000-8005-000000000001";
const rt14 = "00000000-0000-4000-8007-000000000014";

test.use({ viewport: { width: 1440, height: 900 } });

const slideOf = (url: string) => /slides\/([^/?]+)/.exec(url)?.[1] ?? "";

async function openA1(page: Page) {
  await page.goto(`/projects/${p07}/slides/${a1}?task=${rt14}&as=DH`);
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
    timeout: 20_000,
  });
}

async function openPopover(page: Page) {
  await page.getByTestId("live-top-bar").getByTestId("slide-picker").click();
  const popover = page.getByRole("dialog", { name: "Slides in this case and task" });
  await expect(popover).toBeVisible();
  return popover;
}

test("the slides popover on RT-14 shows the case, the loose slides and its three actions", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await openA1(page);
  let popover = await openPopover(page);
  await expect(popover).toContainText("Case S26-04812");
  await expect(popover).toContainText("Sentinel node AI evaluation");
  await expect(popover.getByRole("button", { name: "Open the case" })).toBeVisible();
  await expect(popover).toContainText("Slides in this case");
  await expect(popover).toContainText("Loose slides in task RT-14");
  await expect(popover.locator("kbd")).toHaveText(["Q", "E"]);
  const size = await popover.evaluate((node: HTMLElement) => [node.offsetWidth, node.offsetHeight]);
  expect(size[0]).toBe(460);
  expect(size[1]).toBeGreaterThan(450);

  const rows = popover.locator('[data-slot="slide-row"]');
  const current = rows.filter({ hasText: "A1 · H&E" }).first();
  await expect(current).toHaveAttribute("data-current", "true");
  await expect(current).toContainText("In review");
  await expect(current).toContainText("CAMELYON");
  await expect(rows.filter({ hasText: "A3 · CK" })).toContainText("Processing");
  await expect(rows.filter({ hasText: "A3 · CK" }).getByRole("progressbar")).toBeVisible();

  const resultSets = popover.getByRole("button", { name: "Result sets of A1" });
  await expect(resultSets).toBeVisible();
  await expect(popover.getByRole("button", { name: "Compare", exact: true })).toBeVisible();
  await expect(popover.getByRole("button", { name: "Add slides" })).toBeVisible();

  await page.getByTestId("stage-inspector").getByRole("tab", { name: "Objects" }).click();
  popover = await openPopover(page);
  await popover.getByRole("button", { name: "Result sets of A1" }).click();
  await expect(popover).toHaveCount(0);
  await expect(
    page.getByTestId("stage-inspector").getByRole("tab", { name: "Display" }),
  ).toHaveAttribute("aria-selected", "true");

  popover = await openPopover(page);
  const loose = popover.locator('[data-slot="slide-row"]').filter({ hasText: "no case attached" });
  await expect(loose.first()).toBeVisible();
  await loose.first().click();
  await expect.poll(() => slideOf(page.url())).not.toBe(a1);
  await expect(page).toHaveURL(new RegExp(`task=${rt14}`));
});

test("Q and E step through the slides of RT-14 on the engine viewer", async ({ page }) => {
  test.setTimeout(90_000);
  await openA1(page);
  await page.keyboard.press("e");
  await expect.poll(() => slideOf(page.url())).not.toBe(a1);
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
    timeout: 20_000,
  });
  await page.keyboard.press("q");
  await expect.poll(() => slideOf(page.url())).toBe(a1);
});

test("Compare and Add slides in the slides popover open compare and the upload flow", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await openA1(page);
  let popover = await openPopover(page);
  await popover.getByRole("button", { name: "Compare", exact: true }).click();
  await expect(page).toHaveURL(/layout=compare/);
  await openA1(page);
  popover = await openPopover(page);
  await popover.getByRole("button", { name: "Add slides" }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${p07}/upload`));
});
