import { expect, type Page, test } from "./a11y.ts";

const p03 = "00000000-0000-4000-8003-000000000003";
const p07 = "00000000-0000-4000-8003-000000000007";
const sentinelCase = "00000000-0000-4000-8004-000000000006";

const contentStartTarget = 108;

const pages: { name: string; path: string; testId: string }[] = [
  {
    name: "the clinical report with its locked line",
    path: `/projects/${p03}/cases/${sentinelCase}/report?scene=signed`,
    testId: "clinical-report",
  },
  {
    name: "the clinical report on its first step",
    path: `/projects/${p03}/cases/${sentinelCase}/report?scene=findings`,
    testId: "clinical-report",
  },
  {
    name: "the new review task",
    path: `/projects/${p07}/tasks/new?scene=slides`,
    testId: "new-task",
  },
  { name: "connect your own model", path: "/admin?scene=addmodel", testId: "connect-model" },
];

async function contentStart(page: Page, testId: string) {
  const flow = page.getByTestId(testId);
  await expect(flow.getByRole("heading").first()).toBeVisible();
  return flow.evaluate((node) => {
    const body = node.querySelector('[data-slot="flow-body"]');
    if (!body) throw new Error("flow body missing");
    return body.getBoundingClientRect().top - node.getBoundingClientRect().top;
  });
}

for (const { name, path, testId } of pages) {
  test(`${name} starts its content below a compact header`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1011 });
    await page.goto(path);
    const start = await contentStart(page, testId);
    console.log(`content start ${name}: ${Math.round(start)}`);
    expect(start).toBeLessThanOrEqual(contentStartTarget);
  });
}
