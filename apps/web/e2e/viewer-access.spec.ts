import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const a1 = "00000000-0000-4000-8005-000000000001";
const rt14 = "00000000-0000-4000-8007-000000000014";
const rt09 = "00000000-0000-4000-8007-000000000009";

test.use({ viewport: { width: 1440, height: 900 } });

const viewerOf = (task: string, extra = "") =>
  `/projects/${p07}/slides/${a1}?task=${task}&tab=opinion${extra}`;

async function ready(page: Page) {
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
    timeout: 20_000,
  });
}

async function lookOnlyRail(page: Page) {
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-access", "read-only");
  const tools = page.locator("button[data-tool]");
  await expect(tools).toHaveCount(3);
  expect(await tools.evaluateAll((all) => all.map((tool) => tool.dataset["tool"]))).toEqual([
    "select",
    "hand",
    "ruler",
  ]);
  await expect(page.getByTestId("top-submit")).toHaveCount(0);
}

async function opinionWithoutInputs(page: Page, reason: string) {
  const opinion = page.getByTestId("stage-opinion");
  await expect(opinion).toHaveAttribute("data-read-only", "", { timeout: 15_000 });
  await expect(opinion.locator("[data-slot=read-only-reason]")).toHaveText(reason);
  await expect(opinion.getByRole("button")).toHaveCount(0);
  await expect(opinion.getByRole("radio")).toHaveCount(0);
  await expect(opinion.locator("textarea, input")).toHaveCount(0);
}

test("someone not assigned gets a look only rail, no Submit and no Opinion tab", async ({
  page,
}) => {
  await page.goto(viewerOf(rt14, "&as=DH"));
  await ready(page);
  await expect(page.getByTestId("read-only-notice")).toBeVisible();
  await lookOnlyRail(page);
  await expect(page.getByRole("tab", { name: "Opinion" })).toHaveCount(0);
  await expect(page.getByTestId("stage-opinion")).toHaveCount(0);
});

test("a signed off task shows the opinion answers without inputs and no Submit", async ({
  page,
}) => {
  await page.goto(viewerOf(rt09));
  await ready(page);
  await expect(page.getByTestId("signed-off-notice")).toBeVisible({ timeout: 15_000 });
  await lookOnlyRail(page);
  await opinionWithoutInputs(page, "The task is signed off. An owner can reopen it.");
});

test("a withdrawn task shows the opinion answers without inputs and no Submit", async ({
  page,
}) => {
  await page.goto(viewerOf(rt14, "&issue=withdrawn"));
  await ready(page);
  await expect(page.getByTestId("stage-issue")).toHaveAttribute("data-issue", "withdrawn");
  await lookOnlyRail(page);
  await opinionWithoutInputs(
    page,
    "This task was withdrawn, so nothing can be changed. You can look at it read only.",
  );
});

test("the assigned reviewer of an open task keeps the full rail, the form and Submit", async ({
  page,
}) => {
  await page.goto(viewerOf(rt14));
  await ready(page);
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-access", "edit");
  await expect(page.locator("button[data-tool=smart]")).toBeVisible();
  await expect(page.getByTestId("top-submit")).toBeVisible();
  const opinion = page.getByTestId("stage-opinion");
  await expect(opinion).toBeVisible({ timeout: 15_000 });
  await expect(opinion).not.toHaveAttribute("data-read-only", "");
  await expect(opinion.getByRole("button", { name: /^Submit/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Submit/ })).toHaveCount(1);
  await expect(page.getByTestId("read-only-notice")).toHaveCount(0);
});
