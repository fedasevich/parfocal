import { expect, type Page, test } from "@playwright/test";

const rt14 = "00000000-0000-4000-8007-000000000014";
const a1 = "00000000-0000-4000-8005-000000000001";

test.use({ viewport: { width: 1280, height: 900 } });

const answers = (page: Page, object: string) =>
  page.getByRole("group", { name: `Your answer on ${object}` });

async function disagreeOn(page: Page, object: string) {
  await page.goto(`/tasks/${rt14}/guided?slide=${a1}&scene=region`);
  await answers(page, object)
    .getByRole("button", { name: /Disagree/ })
    .click();
  await expect(page.getByText(`You disagree with the AI on ${object}`)).toBeVisible();
}

test("disagreeing on a region offers four reasons and keeps the chosen one", async ({ page }) => {
  await disagreeOn(page, "T5");
  for (const label of [
    "Not tumor",
    "Boundary is off",
    "Two regions, not one",
    "Artefact or fold",
  ]) {
    await expect(page.getByRole("button", { name: label })).toBeVisible();
  }
  const reason = page.getByRole("button", { name: "Boundary is off" });
  await reason.click();
  await expect(reason).toHaveAttribute("aria-pressed", "true");
});

test("redrawing the outline from guided review saves a new outline and leaves the AI one", async ({
  page,
}) => {
  await disagreeOn(page, "T5");
  const saved = page.waitForRequest(
    (request) => request.method() === "PUT" && request.url().includes("/edits/T5"),
  );
  await page.getByRole("button", { name: "Redraw the outline" }).click();
  const panel = page.getByTestId("redraw-panel");
  await expect(panel).toContainText("Draw the new outline of T5");
  await expect(panel.getByRole("button", { name: "Finish outline" })).toBeDisabled();
  const stage = page.locator("[data-slot=slide-still]");
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };
  for (const [x, y] of [
    [0.3, 0.3],
    [0.6, 0.32],
    [0.58, 0.6],
    [0.32, 0.55],
  ] as const) {
    await page.mouse.click(box.x + box.width * x, box.y + box.height * y);
  }
  await expect(page.getByTestId("redraw-vertex")).toHaveCount(4);
  await page.getByRole("button", { name: "Finish outline" }).click();
  const request = await saved;
  const body = request.postDataJSON() as {
    geometry: { type: string; coordinates: number[][][] };
  };
  expect(body.geometry.type).toBe("Polygon");
  const ring = body.geometry.coordinates[0] ?? [];
  expect(ring).toHaveLength(5);
  expect(Math.max(...ring.map((position) => position[0] ?? 0))).toBeGreaterThan(30_000);
  await expect(page.getByTestId("redrawn-outline")).toHaveAttribute("data-points", "4");
  await expect(page.getByTestId("redraw-panel")).toHaveCount(0);
  const drawn = await page.getByTestId("redrawn-outline").getAttribute("points");

  await page.reload();
  await expect(page.getByTestId("redrawn-outline")).toHaveAttribute("data-points", "4");
  const again = await page.getByTestId("redrawn-outline").getAttribute("points");
  expect(again).toBe(drawn);
});
