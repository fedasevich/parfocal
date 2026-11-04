import { expect, test } from "@playwright/test";

const p07 = "00000000-0000-4000-8003-000000000007";
const rt14 = "00000000-0000-4000-8007-000000000014";
const a1 = "00000000-0000-4000-8005-000000000001";
const ready = 20_000;
const slidePath = (persona: string) => `/projects/${p07}/slides/${a1}?task=${rt14}&as=${persona}`;

test("two people on one slide see each other within 2 s and it clears when one leaves", async ({
  context,
}) => {
  const lenka = await context.newPage();
  const anna = await context.newPage();
  await lenka.goto(slidePath("LM"));
  await expect(lenka.locator("header").first()).toBeVisible({ timeout: ready });
  await anna.goto(slidePath("AK"));
  await expect(anna.locator("header").first()).toBeVisible({ timeout: ready });
  await expect(lenka.getByTestId("presence")).toHaveAttribute("aria-label", /Anna Kopecká/, {
    timeout: 2000,
  });
  await expect(anna.getByTestId("presence")).toHaveAttribute("aria-label", /Lenka Malá/, {
    timeout: 2000,
  });
  await anna.goto("/");
  await expect(lenka.getByTestId("presence")).toHaveCount(0, { timeout: 2000 });
});

test("the project page shows who is viewing which slide and clears when they leave", async ({
  context,
}) => {
  const lenka = await context.newPage();
  const anna = await context.newPage();
  await lenka.goto(`/projects/${p07}?tab=slides&as=LM`);
  await expect(lenka.getByTestId("slide-row").first()).toBeVisible({ timeout: ready });
  await anna.goto(slidePath("AK"));
  await expect(anna.locator("header").first()).toBeVisible({ timeout: ready });
  const viewers = lenka.getByTestId("slide-viewers");
  await expect(viewers).toHaveCount(1, { timeout: 2000 });
  await expect(viewers).toHaveAttribute("aria-label", /Anna Kopecká/);
  await anna.goto("/");
  await expect(viewers).toHaveCount(0, { timeout: 2000 });
});
