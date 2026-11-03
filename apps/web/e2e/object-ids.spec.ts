import { expect, type Page, test } from "@playwright/test";

async function viewerLink(page: Page, name: string) {
  await page.goto("/prototype");
  const link = page.getByRole("list", { name: "Screens" }).getByRole("link", { name, exact: true });
  const href = await link.getAttribute("href");
  if (href === null) throw new Error(`no link named ${name}`);
  return href;
}

const tags = (page: Page) => page.locator("[data-tag]");
const labelSwitch = (page: Page) => page.getByRole("switch", { name: /ID labels/ });

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

test.setTimeout(60_000);

test("the ID labels switch in the Display tab turns the tags on the slide off and on", async ({
  page,
}) => {
  await page.goto(await viewerLink(page, "Visualize · Display panel, the task default"));
  await expect(labelSwitch(page)).toBeChecked({ timeout: 25_000 });
  await expect.poll(() => tags(page).count()).toBeGreaterThan(0);
  const shown = await tags(page).count();
  await labelSwitch(page).click();
  await expect(labelSwitch(page)).not.toBeChecked();
  await expect(tags(page)).toHaveCount(0);
  await labelSwitch(page).click();
  await expect(tags(page)).toHaveCount(shown);
});

test("the tags on the slide never overlap each other", async ({ page }) => {
  await page.goto(await viewerLink(page, "Visualize · Objects on the slide"));
  await expect.poll(() => tags(page).count()).toBeGreaterThan(1);
  const boxes = await tags(page).evaluateAll((elements) =>
    elements.map((element) => {
      const { left, top, right, bottom } = element.getBoundingClientRect();
      return { id: element.getAttribute("data-tag") ?? "", left, top, right, bottom };
    }),
  );
  for (let one = 0; one < boxes.length; one++) {
    for (let two = one + 1; two < boxes.length; two++) {
      const a = boxes[one];
      const b = boxes[two];
      if (a === undefined || b === undefined) throw new Error("missing box");
      const apart =
        a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;
      expect(apart, `${a.id} and ${b.id}`).toBe(true);
    }
  }
});

test("the ID tag in the object table copies the full ID of the object", async ({ page }) => {
  await page.goto(await viewerLink(page, "Visualize · Object table and stats"));
  const table = page.getByRole("region", { name: "Objects on A1" });
  const copy = table.getByRole("button", { name: /^Copy ID .*\/A1\/T2$/ });
  await copy.click();
  await expect(copy).toHaveAttribute("data-copied", "true");
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toMatch(/^[^/]+\/[^/]+\/A1\/T2$/);
  await expect(page).not.toHaveURL(/object=T2/);
});
