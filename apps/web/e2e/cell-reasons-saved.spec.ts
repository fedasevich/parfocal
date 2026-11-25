import { expect, type Locator, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const rt16 = "00000000-0000-4000-8043-000000000016";
const cellsSlide = "00000000-0000-4000-8005-000000000008";

test.use({ viewport: { width: 1440, height: 900 } });

type Saved = { reasons?: string[]; reason_class_id?: string | null };

async function openCell(page: Page) {
  await page.addInitScript(() => {
    const real = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      const method = input instanceof Request ? input.method : (init?.method ?? "GET");
      const path = new URL(url, window.location.href).pathname;
      if (
        method === "PUT" &&
        /\/decisions\/C2$/.test(path) &&
        sessionStorage.getItem("refuse") === "yes"
      ) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ type: "about:blank", title: "Failed", status: 500, code: "server" }),
            { status: 500, headers: { "content-type": "application/problem+json" } },
          ),
        );
      }
      return real(input, init);
    };
  });
  await page.goto(`/projects/${p07}/slides/${cellsSlide}?task=${rt16}&mode=guided&object=C2`);
  const panel = page.getByTestId("stage-review-objects");
  await expect(panel).toHaveAttribute("data-ready", "true", { timeout: 25_000 });
  const start = page.getByRole("button", { name: "Got it, start" });
  if (await start.isVisible()) await start.click();
  await expect(panel).toHaveAttribute("data-current", "C2");
  return panel;
}

const blur = (page: Page) =>
  page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });

const chip = (panel: Locator, name: string) => panel.getByRole("button", { name, exact: true });

async function pick(page: Page, panel: Locator, name: string) {
  const saved = page.waitForRequest(
    (request) =>
      request.method() === "PUT" && decodeURIComponent(request.url()).endsWith("/decisions/C2"),
  );
  await chip(panel, name).click();
  return (await saved).postDataJSON() as Saved;
}

async function openReasons(page: Page, panel: Locator) {
  await blur(page);
  await page.keyboard.press("1");
  await expect(panel.getByText("You disagree with the AI on C2")).toBeVisible();
}

const pressed = (panel: Locator, name: string, on: boolean) =>
  expect(chip(panel, name)).toHaveAttribute("aria-pressed", String(on));

test("cell reasons show at once, exclude contradictions and come back when the cell is shown again", async ({
  page,
}) => {
  const panel = await openCell(page);
  await openReasons(page, panel);
  const typeChips = (await panel.getByRole("button", { name: /^It is / }).allTextContents()).map(
    (text) => text.trim(),
  );
  expect(typeChips.length).toBeGreaterThanOrEqual(2);
  const [first, second] = typeChips as [string, string];

  const notACell = await pick(page, panel, "Not a cell");
  expect(notACell.reasons).toEqual(["not_a_cell"]);
  await pressed(panel, "Not a cell", true);

  const typed = await pick(page, panel, first);
  expect(typed.reasons).toEqual(["wrong_class"]);
  expect(typed.reason_class_id).not.toBeNull();
  await pressed(panel, first, true);
  await pressed(panel, "Not a cell", false);

  const other = await pick(page, panel, second);
  expect(other.reasons).toEqual(["wrong_class"]);
  expect(other.reason_class_id).not.toEqual(typed.reason_class_id);
  await pressed(panel, second, true);
  await pressed(panel, first, false);

  const artefact = await pick(page, panel, "Artefact");
  expect(artefact.reasons).toEqual(["artefact"]);
  await pressed(panel, "Artefact", true);
  await pressed(panel, second, false);

  const both = await pick(page, panel, "Not a cell");
  expect([...(both.reasons ?? [])].sort()).toEqual(["artefact", "not_a_cell"]);
  await pressed(panel, "Not a cell", true);
  await pressed(panel, "Artefact", true);

  await panel.getByRole("button", { name: /^Next|Skip for now/ }).click();
  await expect(panel).not.toHaveAttribute("data-current", "C2");
  await panel.getByRole("button", { name: /^Previous/ }).click();
  await expect(panel).toHaveAttribute("data-current", "C2");
  await openReasons(page, panel);
  await pressed(panel, "Not a cell", true);
  await pressed(panel, "Artefact", true);
  await pressed(panel, first, false);
  await pressed(panel, second, false);

  await pick(page, panel, "Artefact");
  await pressed(panel, "Artefact", false);
  await pressed(panel, "Not a cell", true);
});

test("a reason that is not saved goes back and says so", async ({ page }) => {
  const panel = await openCell(page);
  await openReasons(page, panel);
  await pick(page, panel, "Not a cell");
  await pressed(panel, "Not a cell", true);

  await page.evaluate(() => sessionStorage.setItem("refuse", "yes"));
  await chip(panel, "Artefact").click();
  await expect(page.getByText("The reasons for C2 were not saved")).toBeVisible();
  await pressed(panel, "Artefact", false);
  await pressed(panel, "Not a cell", true);
});
