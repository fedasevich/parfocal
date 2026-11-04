import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

const p07 = "00000000-0000-4000-8003-000000000007";
const p03 = "00000000-0000-4000-8003-000000000003";
const a1 = "00000000-0000-4000-8005-000000000001";
const rt14 = "00000000-0000-4000-8007-000000000014";

const wcagTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];

test.setTimeout(90_000);

const violationsOf = async (page: Page) => {
  const results = await new AxeBuilder({ page })
    .withTags(wcagTags)
    .exclude("[data-base-ui-focus-guard]")
    .analyze();
  return results.violations.map((violation) => ({
    rule: violation.id,
    targets: violation.nodes.map((node) => node.target.join(" ")),
  }));
};

async function viewerLink(page: Page, name: string) {
  await page.goto("/prototype");
  const link = page.getByRole("list", { name: "Screens" }).getByRole("link", { name, exact: true });
  const href = await link.getAttribute("href");
  if (href === null) throw new Error(`no link named ${name}`);
  return href;
}

test("an object table row takes focus by Tab and opens with Enter", async ({ page }) => {
  await page.goto(await viewerLink(page, "Visualize · Object table and stats"));
  const panel = page.getByRole("region", { name: "Objects on A1" });
  const rows = panel.locator("tbody tr");
  await expect(rows.first()).toBeVisible({ timeout: 25_000 });
  const find = panel.getByRole("textbox", { name: "Find an ID" });
  await find.fill("T2");
  const row = rows.first();
  await expect(row).toContainText("T2");
  await find.focus();
  let reached = false;
  for (let step = 0; step < 6 && !reached; step++) {
    await page.keyboard.press("Tab");
    reached = await row.evaluate((element) => element === document.activeElement);
  }
  expect(reached).toBe(true);
  await page.keyboard.press("Enter");
  await expect(row).toHaveAttribute("data-state", "selected");
});

const screens: { name: string; path: string; ready: (page: Page) => Promise<void> }[] = [
  {
    name: "project slides",
    path: `/projects/${p07}?tab=slides`,
    ready: (page) => expect(page.getByTestId("slide-row").first()).toBeVisible(),
  },
  {
    name: "project tasks",
    path: `/projects/${p07}?tab=tasks`,
    ready: (page) => expect(page.getByTestId("task-row").first()).toBeVisible(),
  },
  {
    name: "my work all slides",
    path: "/my-work?tab=all",
    ready: (page) => expect(page.getByRole("table", { name: "All slides" })).toBeVisible(),
  },
  {
    name: "disagreement queue",
    path: `/tasks/${rt14}/disagreements?scene=queue`,
    ready: (page) => expect(page.locator('[data-slot="queue-row"]').first()).toBeVisible(),
  },
  {
    name: "clinical report deposits",
    path: `/projects/${p03}/slides/${a1}/report?scene=deposits`,
    ready: (page) => expect(page.locator("[data-deposit]").first()).toBeVisible(),
  },
  {
    name: "admin projects",
    path: "/admin?section=projects",
    ready: (page) => expect(page.getByRole("table").first()).toBeVisible(),
  },
  {
    name: "admin people",
    path: "/admin?section=people",
    ready: (page) => expect(page.getByRole("table").first()).toBeVisible(),
  },
];

for (const screen of screens) {
  test(`${screen.name} uses the shared table and passes axe`, async ({ page }) => {
    await page.goto(screen.path);
    await screen.ready(page);
    await expect(page.locator('[data-slot="table"]').first()).toBeVisible();
    expect(await violationsOf(page)).toEqual([]);
  });
}
