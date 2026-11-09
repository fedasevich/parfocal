import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const annotateTask = "00000000-0000-4000-8007-000000000021";
const withResults = "00000000-0000-4000-8005-000000000005";
const byHand = "00000000-0000-4000-8005-000000000014";

test.use({ viewport: { width: 1440, height: 900 } });

async function openTaskSlide(page: Page, slideId: string) {
  await page.goto(`/projects/${p07}/slides/${slideId}/live?task=${annotateTask}&as=DH`);
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 20_000 });
  await expect(stage).toHaveAttribute("data-annotations", "loaded");
  await expect(stage).toHaveAttribute("data-layer", "shared");
  return stage;
}

const corners = [
  [520, 250],
  [700, 270],
  [680, 420],
  [540, 400],
] as const;

test("an annotate task slide draws on the shared layer, fixes AI, checks two slides and signs one off", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const stage = await openTaskSlide(page, withResults);
  const panel = page.getByTestId("annotate-task-panel");
  await expect(panel).toHaveAttribute("data-ai", "shown");
  await expect(page.getByTestId("task-progress")).toHaveText("0 of 2 slides checked");
  await expect(page.getByTestId("ai-object")).toHaveCount(6);
  const counts = page.getByTestId("class-count");
  await expect(counts).toHaveCount(3);
  await expect(counts.nth(0)).toContainText("Tumor cell");
  await expect(counts.nth(1)).toContainText("Lymphocyte");
  await expect(counts.nth(2)).toContainText("Mitosis");

  await page.getByRole("switch", { name: "Show the AI result" }).click();
  await expect(panel).toHaveAttribute("data-ai", "hidden");
  await expect(page.getByTestId("ai-layer")).toHaveCount(0);
  await page.getByRole("switch", { name: "Show the AI result" }).click();
  await expect(page.getByTestId("ai-object")).toHaveCount(6);

  const box = (await stage.boundingBox()) ?? { x: 0, y: 0 };
  await page.keyboard.press("p");
  for (const [x, y] of corners) await page.mouse.click(box.x + x, box.y + y);
  await page.mouse.click(box.x + corners[0][0] + 2, box.y + corners[0][1] + 1);
  await expect(page.getByTestId("polygon-shape")).toHaveCount(1);
  await expect(stage).toHaveAttribute("data-save-state", "saved");

  await page.keyboard.press("m");
  await page.keyboard.press("3");
  await page.mouse.click(box.x + 800, box.y + 500);
  await expect(page.getByTestId("count-marker")).toHaveCount(1);
  await expect(page.getByTestId("count-marker")).toHaveAttribute(
    "data-class",
    "00000000-0000-4000-8021-000000000003",
  );
  await expect(stage).toHaveAttribute("data-save-state", "saved");
  await page.keyboard.press("Escape");

  const human = page.locator('[data-testid="task-object"][data-origin="human"]');
  await expect(human).toHaveCount(2);
  await expect(counts.nth(2)).toContainText("1");

  await page.getByRole("button", { name: /^C1/ }).click();
  await page.keyboard.press("d");
  await expect(page.getByRole("button", { name: /^C1/ })).toHaveAttribute(
    "data-origin",
    "ai-confirmed",
  );
  await page.getByRole("button", { name: /^C2/ }).click();
  await page.getByRole("button", { name: "Delete C2" }).click();
  await expect(page.getByRole("button", { name: /^C2/ })).toHaveAttribute(
    "data-origin",
    "ai-edited",
  );
  await expect(page.getByTestId("ai-object")).toHaveCount(5);

  await page.reload();
  await expect(stage).toHaveAttribute("data-annotations", "loaded", { timeout: 20_000 });
  await expect(page.getByTestId("polygon-shape")).toHaveCount(1);
  await expect(page.getByTestId("count-marker")).toHaveCount(1);
  await expect(page.getByRole("button", { name: /^C1/ })).toHaveAttribute(
    "data-origin",
    "ai-confirmed",
  );

  await page.getByRole("button", { name: "Mark slide checked" }).click();
  await expect(panel).toHaveAttribute("data-step", "checked");
  await expect(page.getByRole("region", { name: "Slide checked" })).toBeVisible();
  await expect(page.getByTestId("task-progress")).toHaveText("1 of 2 slides checked");

  await page.getByRole("button", { name: "Sign off", exact: true }).click();
  await expect(panel).toHaveAttribute("data-step", "signed-off");
  await expect(page.getByText("Signed off").first()).toBeVisible();
  await expect(page.getByTestId("task-progress")).toHaveText("1 of 2 slides checked, 1 signed off");

  await page.getByRole("button", { name: "Next slide" }).click();
  await expect(page).toHaveURL(new RegExp(`/slides/${byHand}/live`));
  await expect(stage).toHaveAttribute("data-annotations", "loaded", { timeout: 20_000 });
  await expect(panel).toHaveAttribute("data-ai", "none");
  await expect(page.getByTestId("no-result-set")).toBeVisible();
  await expect(page.getByTestId("ai-layer")).toHaveCount(0);
  await page.getByRole("button", { name: "Nothing to mark" }).click();
  await expect(panel).toHaveAttribute("data-step", "checked");
  await expect(page.getByTestId("task-progress")).toHaveText("2 of 2 slides checked, 1 signed off");
});
