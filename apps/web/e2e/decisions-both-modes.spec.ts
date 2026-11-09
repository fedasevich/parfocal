import { expect, type Page, test } from "./a11y.ts";

const rt14 = "00000000-0000-4000-8007-000000000014";

test.use({ viewport: { width: 1280, height: 1100 } });

const panel = (page: Page) => page.getByRole("complementary", { name: "Side panel" });
const row = (page: Page, object: string) =>
  panel(page).getByRole("button", { name: new RegExp(`^${object} Tumor region`) });
const progress = (page: Page) => page.getByRole("button", { name: /% done:/ });
const counted = async (page: Page) =>
  (await progress(page).getByRole("img").getAttribute("aria-label")) ?? "";
const answers = (page: Page, object: string) =>
  page.getByRole("group", { name: `Your answer on ${object}` });

async function plainFullViewerUrl(page: Page) {
  await page.goto("/prototype");
  const link = page
    .getByRole("list", { name: "Screens" })
    .getByRole("link", { name: "Full viewer · Objects tab", exact: true });
  const href = (await link.getAttribute("href")) ?? "";
  const url = new URL(href, "http://localhost");
  return `${url.pathname}?task=${rt14}`;
}

test("K, X and U decide the selected object in the full viewer and the list shows each", async ({
  page,
}) => {
  await page.goto(await plainFullViewerUrl(page));
  await row(page, "T5").click();
  await page.keyboard.press("x");
  await expect(page.getByText("T5: disagree")).toBeVisible();
  await expect(row(page, "T5")).toContainText("disagree");
  await row(page, "T4").click();
  await page.keyboard.press("k");
  await expect(row(page, "T4")).toContainText("agree");
  await row(page, "T3").click();
  await page.keyboard.press("u");
  await expect(row(page, "T3")).toContainText("not sure");
  await expect(answers(page, "T3").getByRole("button", { name: /Not sure/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("a decision made in one mode is there in the other and both count one review", async ({
  page,
}) => {
  await page.goto(await plainFullViewerUrl(page));
  const before = await counted(page);
  await row(page, "T5").click();
  await page.keyboard.press("x");
  await expect(row(page, "T5")).toContainText("disagree");
  await row(page, "T3").click();
  await page.keyboard.press("u");
  await expect(row(page, "T3")).toContainText("not sure");
  const inFull = await counted(page);
  expect(inFull).not.toBe(before);

  await page.getByRole("radio", { name: "Guided" }).click();
  await expect(page).toHaveURL(/\/guided\?.*object=T3/);
  await expect(answers(page, "T3").getByRole("button", { name: /Not sure/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(progress(page).getByRole("img")).toHaveAttribute("aria-label", inFull);
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(answers(page, "T5").getByRole("button", { name: /Disagree/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await page.keyboard.press("k");
  await expect(page.getByText("T5: agree").first()).toBeVisible();
  const inGuided = await counted(page);
  expect(inGuided).not.toBe(inFull);

  await page.getByRole("radio", { name: "Full viewer" }).click();
  await expect(page.getByTestId("full-viewer")).toBeVisible();
  await expect(row(page, "T5")).toContainText("agree");
  await expect(row(page, "T3")).toContainText("not sure");
  await expect(progress(page).getByRole("img")).toHaveAttribute("aria-label", inGuided);
});

test("Undo in the full viewer takes the decision back for the guided review too", async ({
  page,
}) => {
  await page.goto(await plainFullViewerUrl(page));
  const before = await counted(page);
  await row(page, "T5").click();
  await page.keyboard.press("x");
  await expect(row(page, "T5")).toContainText("disagree");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(row(page, "T5")).toContainText("open");
  await page.getByRole("radio", { name: "Guided" }).click();
  await expect(page).toHaveURL(/\/guided\?.*object=T5/);
  await expect(answers(page, "T5").getByRole("button", { pressed: true })).toHaveCount(0);
  await expect(progress(page).getByRole("img")).toHaveAttribute("aria-label", before);
});
