import { expect, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";

const rt14 = "00000000-0000-4000-8007-000000000014";
const a1 = "00000000-0000-4000-8005-000000000001";
const objectsOf = `/api/review-tasks/${rt14}/slides/${a1}/objects`;

test("a slide whose review order is still being prepared waits with a way back and a check", async ({
  page,
}) => {
  const polls: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === objectsOf) polls.push(request.url());
  });
  await page.goto(`/projects/${p07}/slides/${a1}?task=${rt14}&mode=guided&issue=preparing`);
  const waiting = page.getByTestId("review-order-preparing");
  await expect(waiting).toBeVisible();
  await expect(waiting.getByText(/being put in review order/)).toBeVisible();
  const back = page.getByTestId("review-order-back");
  await expect(back).toHaveText(/^Back to /);
  await expect(back).toHaveAttribute("href", /^\/(projects\/[0-9a-f-]{36}|my-work)$/);
  await expect.poll(() => polls.length, { timeout: 10_000 }).toBeGreaterThan(1);
  const before = polls.length;
  await page.getByTestId("review-order-retry").click();
  await expect.poll(() => polls.length).toBeGreaterThan(before);
  await expect(waiting).toBeVisible();
  await back.click();
  await expect(waiting).toHaveCount(0);
  await expect(page).not.toHaveURL(/\/guided/);
});

test("the review tabs say the order is being prepared and keep the opinion closed", async ({
  page,
}) => {
  await page.goto(`/projects/${p07}/slides/${a1}?task=${rt14}&mode=cells&issue=preparing`);
  await expect(page.getByTestId("review-order-tab-preparing")).toBeVisible({ timeout: 20_000 });
  await page.getByRole("tab", { name: /^Opinion/ }).click();
  await expect(page.getByTestId("review-order-opinion-closed")).toBeVisible();
});
