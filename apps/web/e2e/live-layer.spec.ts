import { expect, type Page, test } from "@playwright/test";

const p07 = "00000000-0000-4000-8003-000000000007";
const annotateTask = "00000000-0000-4000-8007-000000000021";
const byHand = "00000000-0000-4000-8005-000000000014";

test.use({ viewport: { width: 1440, height: 900 } });

async function openAs(page: Page, persona: string) {
  await page.goto(`/projects/${p07}/slides/${byHand}/live?task=${annotateTask}&as=${persona}`);
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 20_000 });
  await expect(stage).toHaveAttribute("data-annotations", "loaded");
  return stage;
}

const corners = [
  [520, 250],
  [700, 270],
  [680, 420],
  [540, 400],
] as const;

test("a colleague's polygon waits behind the changes marker and appears on a click", async ({
  context,
}) => {
  test.setTimeout(90_000);
  const lenka = await context.newPage();
  const anna = await context.newPage();
  const lenkaStage = await openAs(lenka, "LM");
  const annaStage = await openAs(anna, "AK");
  await expect(lenka.getByTestId("presence")).toHaveCount(1, { timeout: 5000 });

  const box = (await annaStage.boundingBox()) ?? { x: 0, y: 0 };
  await anna.keyboard.press("p");
  for (const [x, y] of corners) await anna.mouse.click(box.x + x, box.y + y);
  await anna.mouse.click(box.x + corners[0][0] + 2, box.y + corners[0][1] + 1);
  await expect(anna.getByTestId("polygon-shape")).toHaveCount(1);
  await expect(annaStage).toHaveAttribute("data-save-state", "saved");

  const marker = lenka.getByTestId("changes-by");
  await expect(marker).toBeVisible({ timeout: 5000 });
  await expect(marker).toContainText("Anna");
  await expect(marker).toContainText("added 1");
  await expect(lenka.getByTestId("polygon-shape")).toHaveCount(0);

  await marker.click();
  await expect(lenka.getByTestId("polygon-shape")).toHaveCount(1);
  await expect(marker).toHaveCount(0);
  await expect(lenkaStage).toHaveAttribute("data-save-state", /idle|saved/);
});

test("a colleague's polygon arrives by itself after the expert pauses", async ({ context }) => {
  test.setTimeout(90_000);
  const lenka = await context.newPage();
  const anna = await context.newPage();
  await openAs(lenka, "LM");
  const annaStage = await openAs(anna, "AK");

  const box = (await annaStage.boundingBox()) ?? { x: 0, y: 0 };
  await anna.keyboard.press("p");
  for (const [x, y] of corners) await anna.mouse.click(box.x + x, box.y + y);
  await anna.mouse.click(box.x + corners[0][0] + 2, box.y + corners[0][1] + 1);
  await expect(anna.getByTestId("polygon-shape")).toHaveCount(1);

  await expect(lenka.getByTestId("changes-by")).toBeVisible({ timeout: 5000 });
  await expect(lenka.getByTestId("polygon-shape")).toHaveCount(1, { timeout: 10_000 });
  await expect(lenka.getByTestId("changes-by")).toHaveCount(0);
});
