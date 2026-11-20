import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const a1 = "00000000-0000-4000-8005-000000000001";
const rt14 = "00000000-0000-4000-8007-000000000014";
const a2 = "00000000-0000-4000-8005-000000000002";

test.use({ viewport: { width: 1440, height: 900 } });

async function cellsLine(page: Page, url: string) {
  await page.goto(url);
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
    timeout: 20_000,
  });
  await page.getByRole("tab", { name: "Objects" }).click();
  const line = page.getByText(/^\d+ in your sample$/).first();
  await expect(line).toBeVisible({ timeout: 15_000 });
  return (await line.textContent()) ?? "";
}

test("the AI says Cells line counts the slide's own sample and never a fixed number", async ({
  page,
}) => {
  const first = await cellsLine(page, `/projects/${p07}/slides/${a1}?task=${rt14}&mode=review`);
  const second = await cellsLine(page, `/projects/${p07}/slides/${a2}?task=${rt14}&mode=review`);
  for (const line of [first, second]) {
    expect(line).not.toContain("18,240");
    expect(line).toMatch(/^\d+ in your sample$/);
  }
});
