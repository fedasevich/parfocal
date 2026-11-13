import { expect, type Page, test } from "./a11y.ts";

const rt14 = "00000000-0000-4000-8007-000000000014";
const a1 = "00000000-0000-4000-8005-000000000001";
const a2 = "00000000-0000-4000-8005-000000000002";
const cells = 250_000;

test.describe.configure({ mode: "serial", timeout: 120_000 });
test.use({ viewport: { width: 1280, height: 900 } });

const panel = (page: Page) => page.getByRole("complementary", { name: "Side panel" });
const probe = (page: Page) => page.getByTestId("paged-review");
const tiles = (page: Page) =>
  panel(page)
    .getByRole("group", { name: /^Unsure cells in/ })
    .getByRole("button");

async function pagedUrl(page: Page) {
  await page.goto("/prototype");
  const link = page
    .getByRole("list", { name: "Screens" })
    .getByRole("link", { name: "Full viewer · Objects tab", exact: true });
  const href = ((await link.getAttribute("href")) ?? "").replace(a1, a2);
  return `${href}${href.includes("?") ? "&" : "?"}pagedCells=${cells}`;
}

type Saved = {
  object: string;
  value: string;
  ai_class_id: string | null;
  ai_score: number | null;
};

async function savedDecisions(page: Page) {
  return page.evaluate(
    async ([task, slide]) => {
      const response = await fetch(`/api/review-tasks/${task}/slides/${slide}/decisions`);
      const body = (await response.json()) as Saved[] | { items?: Saved[] };
      return Array.isArray(body) ? body : (body.items ?? []);
    },
    [rt14, a2],
  );
}

test("a reviewer fades, zones and decides cells on a paged result of 250,000 nuclei", async ({
  page,
}) => {
  await page.goto(await pagedUrl(page));
  await expect(probe(page)).toHaveAttribute("data-ready", "true", { timeout: 60_000 });
  await expect(probe(page)).toHaveAttribute("data-cells", String(cells));
  await expect(probe(page)).toHaveAttribute("data-paged", "true");
  expect(Number(await probe(page).getAttribute("data-working-set"))).toBeGreaterThan(100);

  await panel(page)
    .getByRole("list", { name: "Zones where the AI is unsure" })
    .getByRole("button", { name: /^Zone 1(?!\d)/ })
    .click();
  const count = await tiles(page).count();
  expect(count).toBeGreaterThan(1);

  await tiles(page).first().click();
  await expect(page).toHaveURL(/object=C\d+/);
  await expect
    .poll(async () => Number(await probe(page).getAttribute("data-drawn")), { timeout: 60_000 })
    .toBeGreaterThan(50);
  const resident = Number(await probe(page).getAttribute("data-resident"));
  expect(resident).toBeGreaterThan(0);
  expect(resident).toBeLessThan(cells / 4);
  expect(Number(await probe(page).getAttribute("data-distinct-alphas"))).toBeGreaterThan(5);

  const outlines = page.locator("[data-object] path");
  const faded = new Set(
    await outlines.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("stroke-opacity"))),
  );
  expect(faded.size).toBeGreaterThan(1);

  await page.getByTestId("cell-type-bar").getByRole("button", { name: /Keep/ }).click();
  await expect(page.getByText(/: agree$/).first()).toBeVisible();
  await expect.poll(async () => (await savedDecisions(page)).length).toBeGreaterThan(0);
  const saved = (await savedDecisions(page)).find((item) => /^C\d+$/.test(item.object));
  expect(saved?.value).toBe("agree");
  expect(saved?.ai_class_id).toBeTruthy();
  expect(saved?.ai_score).toBeGreaterThan(0);

  expect(page.url()).toContain(`pagedCells=${cells}`);
  await page.goto(`${page.url()}&focus=true`);
  await expect(page.getByTestId("cell-focus")).toBeVisible();
  await expect(page.getByTestId("cell-type-bar")).toBeVisible();
  await expect(page.locator("[data-testid=cell-focus] [data-object]").first()).toBeAttached({
    timeout: 60_000,
  });
});

test("the zone list covers the slide and a far field keeps its zone and the first decision", async ({
  page,
}) => {
  await page.goto(await pagedUrl(page));
  await expect(probe(page)).toHaveAttribute("data-ready", "true", { timeout: 60_000 });
  await expect
    .poll(async () => Number(await probe(page).getAttribute("data-indexed")), { timeout: 60_000 })
    .toBeGreaterThan(1000);

  const zoneList = panel(page).getByRole("list", { name: "Zones where the AI is unsure" });
  const zoneButtons = zoneList.getByRole("button", { name: /^Zone \d+/ });
  await expect.poll(() => zoneButtons.count()).toBeGreaterThan(20);

  await zoneButtons.first().click();
  await tiles(page).first().click();
  await expect(page).toHaveURL(/object=C\d+/);
  const firstObject = new URL(page.url()).searchParams.get("object") ?? "";
  await page.getByTestId("cell-type-bar").getByRole("button", { name: /Keep/ }).click();
  await expect(page.getByText(/: agree$/).first()).toBeVisible();
  await expect.poll(async () => (await savedDecisions(page)).length).toBeGreaterThan(0);

  const before = Number(await probe(page).getAttribute("data-working-set"));
  const fieldsBefore = Number(await probe(page).getAttribute("data-fields"));
  await panel(page).getByRole("button", { name: "All zones" }).click();
  await zoneButtons.last().click();
  await tiles(page).first().click();
  await expect(page).toHaveURL(/object=C\d+/);
  const farObject = new URL(page.url()).searchParams.get("object") ?? "";
  expect(farObject).not.toBe(firstObject);
  await expect
    .poll(async () => Number(await probe(page).getAttribute("data-fields")))
    .toBeGreaterThan(fieldsBefore);
  await expect
    .poll(async () => Number(await probe(page).getAttribute("data-drawn")), { timeout: 60_000 })
    .toBeGreaterThan(50);
  expect(Number(await probe(page).getAttribute("data-working-set"))).toBeGreaterThan(before);

  await page.keyboard.press("ArrowRight");
  await expect.poll(() => new URL(page.url()).searchParams.get("object")).not.toBe(farObject);

  const allZones = panel(page).getByRole("button", { name: "All zones" });
  if ((await allZones.count()) > 0) await allZones.click();
  await zoneButtons.first().click();
  await expect(tiles(page).first()).toBeVisible();
  await expect(
    panel(page).getByRole("button", { name: new RegExp(`^${firstObject} .*, agree$`) }),
  ).toBeVisible();
});
