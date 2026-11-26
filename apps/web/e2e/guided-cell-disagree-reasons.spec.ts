import { expect, type Locator, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const rt14 = "00000000-0000-4000-8007-000000000014";
const cellsSlide = "00000000-0000-4000-8005-000000000008";

test.use({ viewport: { width: 1440, height: 900 } });

type Saved = { reasons?: string[]; reason_class_id?: string | null };

const blur = (page: Page) =>
  page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });

const chip = (panel: Locator, name: string) => panel.getByRole("button", { name, exact: true });

const pressed = (panel: Locator, name: string, on: boolean) =>
  expect(chip(panel, name)).toHaveAttribute("aria-pressed", String(on));

const savedFor = (page: Page, object: string) =>
  page.waitForRequest(
    (request) =>
      request.method() === "PUT" &&
      decodeURIComponent(request.url()).endsWith(`/decisions/${object}`),
  );

async function openCell(page: Page) {
  await page.goto(`/projects/${p07}/slides/${cellsSlide}?task=${rt14}&mode=guided&object=C2`);
  const panel = page.getByTestId("stage-review-objects");
  await expect(panel).toHaveAttribute("data-ready", "true", { timeout: 25_000 });
  const start = page.getByRole("button", { name: "Got it, start" });
  if (await start.isVisible()) await start.click();
  await expect(panel).toHaveAttribute("data-current", "C2");
  await expect(page.getByTestId("cell-type-bar")).toBeVisible();
  return panel;
}

test("X in guided cell review opens What is wrong for that cell and keeps the reasons", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const panel = await openCell(page);
  await blur(page);
  const decided = savedFor(page, "C2");
  await page.keyboard.press("x");
  expect(((await decided).postDataJSON() as Saved).reasons).toEqual(["not_a_cell"]);

  await expect(panel).toHaveAttribute("data-current", "C2");
  await expect(panel.getByText("You disagree with the AI on C2")).toBeVisible();
  await expect(page.getByTestId("cell-type-bar")).toHaveCount(0);
  await pressed(panel, "Not a cell", true);

  const reason = savedFor(page, "C2");
  await chip(panel, "Artefact").click();
  expect([...(((await reason).postDataJSON() as Saved).reasons ?? [])].sort()).toEqual([
    "artefact",
    "not_a_cell",
  ]);
  await pressed(panel, "Artefact", true);

  await panel.getByRole("button", { name: /^Next|Skip for now/ }).click();
  await expect(panel).not.toHaveAttribute("data-current", "C2");
  await panel.getByRole("button", { name: /^Previous/ }).click();
  await expect(panel).toHaveAttribute("data-current", "C2");
  await blur(page);
  await page.keyboard.press("x");
  await expect(panel.getByText("You disagree with the AI on C2")).toBeVisible();
  await pressed(panel, "Artefact", true);
  await pressed(panel, "Not a cell", true);
});

test("the Disagree button of the type bar opens What is wrong and stays on the cell", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const panel = await openCell(page);
  await page
    .getByTestId("cell-type-bar")
    .getByRole("button", { name: /Disagree/ })
    .click();
  await expect(panel).toHaveAttribute("data-current", "C2");
  await expect(panel.getByText("You disagree with the AI on C2")).toBeVisible();
  await pressed(panel, "Not a cell", true);
});
