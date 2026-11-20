import { expect, type Page, test } from "./a11y.ts";
import { area, ok, realTags, signIn, viewableTask } from "./real.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const rt14 = "00000000-0000-4000-8007-000000000014";
const a1 = "00000000-0000-4000-8005-000000000001";

test.use({ viewport: { width: 1440, height: 900 } });

async function openGuided(page: Page, extra = "") {
  await page.goto(`/projects/${p07}/slides/${a1}?task=${rt14}&mode=guided${extra}`);
  const panel = page.getByTestId("stage-review-objects");
  await expect(panel).toHaveAttribute("data-ready", "true", { timeout: 25_000 });
  const start = page.getByRole("button", { name: "Got it, start" });
  if (await start.isVisible()) await start.click();
  return panel;
}

async function disagreeOnCurrent(page: Page, panel: ReturnType<Page["getByTestId"]>) {
  const object = (await panel.getAttribute("data-current")) ?? "";
  await page
    .getByRole("group", { name: `Your answer on ${object}` })
    .getByRole("button", { name: /Disagree/ })
    .click();
  await expect(panel.getByText(`You disagree with the AI on ${object}`)).toBeVisible();
  return object;
}

const editRequest = (page: Page, method: string, object: string) =>
  page.waitForRequest(
    (request) =>
      request.method() === method && decodeURIComponent(request.url()).endsWith(`/edits/${object}`),
  );

async function drawSquare(page: Page) {
  const corners = await page.evaluate(() => {
    const host = document.querySelector('[data-testid="slide-host"]');
    if (host === null) return [];
    const box = host.getBoundingClientRect();
    const free = (x: number, y: number) => {
      const hit = document.elementFromPoint(x, y);
      return hit !== null && host.contains(hit);
    };
    const side = Math.min(box.width, box.height) * 0.12;
    for (let fy = 0.3; fy <= 0.8; fy += 0.05) {
      for (let fx = 0.3; fx <= 0.7; fx += 0.05) {
        const x = box.left + box.width * fx;
        const y = box.top + box.height * fy;
        const square = [
          [x, y],
          [x + side, y],
          [x + side, y + side],
          [x, y + side],
        ];
        if (square.every(([px, py]) => free(px ?? 0, py ?? 0))) return square;
      }
    }
    return [];
  });
  expect(corners).toHaveLength(4);
  for (const [x, y] of corners) await page.mouse.click(x ?? 0, y ?? 0);
}

test("a reviewer redraws a region from the live card, sees it over the AI one and undoes it", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const panel = await openGuided(page);
  const object = await disagreeOnCurrent(page, panel);
  const reason = panel.getByRole("button", { name: "Boundary is off" });
  await reason.click();
  await expect(reason).toHaveAttribute("aria-pressed", "true");
  await panel.getByRole("button", { name: "Redraw the outline" }).click();
  const redraw = panel.getByTestId("redraw-panel");
  await expect(redraw).toContainText(`Draw the new outline of ${object}`);
  await expect(redraw.getByRole("button", { name: "Finish outline" })).toBeDisabled();
  const saved = editRequest(page, "PUT", object);
  await drawSquare(page);
  await expect(page.getByTestId("redraw-vertex")).toHaveCount(4);
  await redraw.getByRole("button", { name: "Finish outline" }).click();
  const body = (await saved).postDataJSON() as {
    class_id: string | null;
    geometry: { type: string; coordinates: number[][][] };
  };
  expect(body.class_id).toBeNull();
  expect(body.geometry.type).toBe("Polygon");
  expect(body.geometry.coordinates[0]).toHaveLength(5);
  const outlines = page.getByTestId("review-object-outlines");
  await expect(outlines).toHaveAttribute("data-reviewed", object);
  await expect(outlines).toHaveAttribute("data-dimmed", object);
  await expect(panel.getByTestId("redraw-panel")).toHaveCount(0);
  await panel.getByRole("button", { name: "Back to the answers" }).click();
  await expect(panel.getByTestId("object-edit-history").getByRole("listitem")).toHaveCount(2);

  const cleared = editRequest(page, "DELETE", object);
  await page.getByRole("button", { name: "Undo" }).click();
  await cleared;
  await expect(outlines).toHaveAttribute("data-reviewed", "");
  await expect(outlines).toHaveAttribute("data-dimmed", "");
});

test("a reviewer changes the type of a cell from the live card and keeps its outline", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const panel = await openGuided(page);
  await panel.getByRole("button", { name: /cells/i }).first().click();
  await expect(panel).toHaveAttribute("data-current", /C\d+$/);
  const object = await disagreeOnCurrent(page, panel);
  await panel.getByRole("button", { name: "Change the type" }).click();
  const picker = panel.getByTestId("review-type-picker");
  await expect(picker).toContainText(`Pick the right type of ${object}`);
  const saved = editRequest(page, "PUT", object);
  const choice = picker.getByRole("button", { pressed: false }).first();
  await choice.click();
  const body = (await saved).postDataJSON() as { class_id: string | null; geometry: unknown };
  expect(body.class_id).not.toBeNull();
  expect(body.geometry).toBeNull();
  await expect(page.getByTestId("review-object-outlines")).toHaveAttribute("data-reviewed", object);
  await expect(panel.getByTestId("review-type-picker")).toHaveCount(0);

  await panel.getByRole("button", { name: "Redraw the outline" }).click();
  const again = editRequest(page, "PUT", object);
  await drawSquare(page);
  await page.keyboard.press("Enter");
  const merged = (await again).postDataJSON() as { class_id: string | null; geometry: unknown };
  expect(merged.class_id).toBe(body.class_id);
  expect(merged.geometry).not.toBeNull();

  const restored = editRequest(page, "PUT", object);
  await page.getByRole("button", { name: "Undo" }).last().click();
  const back = (await restored).postDataJSON() as { class_id: string | null; geometry: unknown };
  expect(back.class_id).toBe(body.class_id);
  expect(back.geometry).toBeNull();
});

test("a read only reviewer sees no fix buttons on the live card", async ({ page }) => {
  const panel = await openGuided(page, "&as=DH");
  await expect(panel.getByRole("button", { name: /Disagree/ })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Redraw the outline" })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Change the type" })).toHaveCount(0);
});

test(
  "a redrawn outline from the live card is stored in the reviewed layer",
  realTags(area.review),
  async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page, "/my-work");
    const { project, task, slide } = await viewableTask(page, "review", true);
    await page.goto(`/projects/${project}/slides/${slide}?task=${task}&mode=guided`);
    const panel = page.getByTestId("stage-review-objects");
    await expect(panel).toHaveAttribute("data-ready", "true", { timeout: 30_000 });
    const start = page.getByRole("button", { name: "Got it, start" });
    if (await start.isVisible()) await start.click();
    const object = (await panel.getAttribute("data-current")) ?? "";
    await disagreeOnCurrent(page, panel);
    await panel.getByRole("button", { name: "Redraw the outline" }).click();
    await drawSquare(page);
    await panel.getByRole("button", { name: "Finish outline" }).click();
    const layer = `/api/review-tasks/${task}/slides/${slide}/layer`;
    const reshaped = async () =>
      (await ok<{ edits: { object: string; geometry: unknown }[] }>(page, "GET", layer)).edits.some(
        (edit) => edit.object === object && edit.geometry !== null,
      );
    await expect.poll(reshaped).toBe(true);
  },
);
