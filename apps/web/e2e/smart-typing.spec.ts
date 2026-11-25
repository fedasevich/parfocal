import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const unclassed = "#a3a3a3";

async function openSmart(page: Page, query = "") {
  await page.goto(`/projects/${p07}?tab=slides${query}`);
  await page
    .getByTestId("slide-row")
    .filter({ hasText: "tumor_044" })
    .getByRole("button", { name: "Open" })
    .click();
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
  await expect(stage).toHaveAttribute("data-annotations", "loaded");
  await page.keyboard.press("s");
  await expect(stage).toHaveAttribute("data-tool", "smart");
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0, width: 800, height: 600 };
  return { stage, centre: { x: box.x + box.width / 2, y: box.y + box.height / 2 } };
}

const layer = (page: Page) => page.getByTestId("smart-layer");
const cells = (page: Page) => page.getByTestId("polygon-shape");
const typeTag = (page: Page) => page.getByTestId("cell-type-tag");
const toggle = (page: Page) => page.getByTestId("smart-auto-type");
const accept = (page: Page) => page.getByTestId("proposal-accept");

async function findCell(page: Page, at: { x: number; y: number }) {
  await page.mouse.click(at.x, at.y);
  await expect(layer(page)).toHaveAttribute("data-phase", "ready");
}

function typerCalls(page: Page): string[] {
  const calls: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/outline-types")) {
      calls.push(request.url());
    }
  });
  return calls;
}

test("typing off leaves new cells untyped and turning it on types the next cells at once", async ({
  page,
}) => {
  const calls = typerCalls(page);
  const { centre } = await openSmart(page);
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === "PUT" && response.url().endsWith("/api/me/setting-layers"),
  );
  await toggle(page).click();
  const body = (await saved).request().postDataJSON() as { values: Record<string, unknown> };
  expect(body.values["smart_auto_type"]).toBe(false);
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");
  await expect(toggle(page)).toHaveText("Typing off");

  await findCell(page, centre);
  await expect(accept(page)).not.toContainText("Accept as");
  await page.keyboard.press("Enter");
  await expect(cells(page)).toHaveCount(1);
  await expect(cells(page).first()).toHaveAttribute("data-type", "");
  await expect(cells(page).first()).toHaveAttribute("data-class", "");
  await expect(cells(page).first()).toHaveAttribute("data-colour", unclassed);
  expect(calls).toHaveLength(0);

  await toggle(page).click();
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
  await findCell(page, { x: centre.x + 60, y: centre.y });
  await expect(accept(page)).not.toContainText("Accept as");
  await page.keyboard.press("Enter");
  await expect(cells(page)).toHaveCount(2);
  await expect(cells(page).nth(1)).toHaveAttribute("data-type", "stroma");
  await expect(cells(page).nth(1)).toHaveAttribute("data-colour", "#6ee7b7");
  await expect(cells(page).first()).toHaveAttribute("data-type", "");
  await expect(cells(page).first()).toHaveAttribute("data-colour", unclassed);
  expect(calls).toHaveLength(1);

  await page.keyboard.press("Escape");
  await page.mouse.click(centre.x, centre.y);
  await page.keyboard.press("2");
  await expect(cells(page).first()).toHaveAttribute("data-class", `${p07}-class-2`);
  await expect(cells(page).first()).toHaveAttribute("data-colour", "#6ee7b7");
});

test("three accepted cells are typed, drawn in three class colours, named on hover and retyped by key", async ({
  page,
}) => {
  const { centre } = await openSmart(page, "&typer=slow");
  const spots = [0, 1, 2].map((step) => ({ x: centre.x + step * 60, y: centre.y }));
  for (const spot of spots) await findCell(page, spot);
  await page.keyboard.press("Enter");
  await expect(cells(page)).toHaveCount(3);
  await expect(page.getByTestId("smart-typing")).toHaveAttribute("data-state", "working");
  await expect(page.getByTestId("smart-typing")).toHaveText("Typing 3 cells");
  await expect(page.getByTestId("smart-typing")).toHaveCount(0, { timeout: 10_000 });

  const typed = ["tumor", "stroma", "other"];
  const colours = ["#f87171", "#6ee7b7", "#fbbf24"];
  for (const [index, type] of typed.entries()) {
    await expect(cells(page).nth(index)).toHaveAttribute("data-type", type);
    await expect(cells(page).nth(index)).toHaveAttribute("data-colour", colours[index] ?? "");
  }

  const second = spots[1] ?? centre;
  await page.mouse.move(second.x, second.y);
  await expect(typeTag(page)).toHaveAttribute("data-from", "hover");
  await expect(typeTag(page)).toHaveAttribute("data-type", "stroma");
  await expect(typeTag(page)).toContainText(/Stroma\s*typer \d+%/);

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-tool", "select");
  const first = spots[0] ?? centre;
  await page.mouse.click(first.x, first.y);
  await page.mouse.move(centre.x, centre.y - 200);
  await expect(typeTag(page)).toHaveAttribute("data-from", "selection");
  await page.keyboard.press("3");
  await expect(cells(page).first()).toHaveAttribute("data-class", `${p07}-class-3`);
  await expect(cells(page).first()).toHaveAttribute("data-colour", "#c084fc");
  await expect(typeTag(page)).toContainText(/Immune\s*typer said tumor \d+%/);
});

test("a typer failure shows a toast and leaves the cells untyped", async ({ page }) => {
  const { centre } = await openSmart(page, "&typer=down");
  await findCell(page, centre);
  await findCell(page, { x: centre.x + 60, y: centre.y });
  await page.keyboard.press("Enter");
  await expect(cells(page)).toHaveCount(2);
  const toast = page.locator('[data-slot="undo-toast-host"] [data-slot="toast"]');
  await expect(toast).toContainText("The typer did not answer, so 2 cells are left untyped");
  await expect(page.getByTestId("smart-typing")).toHaveAttribute("data-state", "failed");
  await expect(page.getByTestId("smart-typing")).toHaveText("Typing failed, 2 untyped");
  await expect(cells(page).first()).toHaveAttribute("data-type", "");
  await expect(cells(page).first()).toHaveAttribute("data-class", "");
  await expect(cells(page).first()).toHaveAttribute("data-colour", unclassed);
});
