import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const rt14 = "00000000-0000-4000-8007-000000000014";

test.use({ viewport: { width: 1440, height: 900 } });
test.describe.configure({ timeout: 90_000 });

async function openAnnotate(page: Page) {
  await page.goto(`/projects/${p07}?tab=slides`);
  await page.getByTestId("slide-row").filter({ hasText: "tumor_044" }).click();
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 25_000 });
  const url = new URL(page.url());
  await page.goto(`${url.pathname}?task=${rt14}&workspace=annotate`);
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 25_000 });
  await expect(stage).toHaveAttribute("data-annotations", "loaded");
  return stage;
}

async function dragRegion(page: Page) {
  const box = (await page.getByTestId("slide-stage").boundingBox()) ?? {
    x: 0,
    y: 0,
    width: 800,
    height: 600,
  };
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x - 30, y - 30);
  await page.mouse.down();
  await page.mouse.move(x, y, { steps: 4 });
  await page.mouse.move(x + 30, y + 30, { steps: 4 });
  await page.mouse.up();
}

test("Annotate with a task open starts on Display with the Layers block", async ({ page }) => {
  await openAnnotate(page);
  const inspector = page.getByTestId("stage-inspector");
  await expect(inspector.getByRole("tab", { name: "Display" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(inspector.getByTestId("layers-panel")).toBeVisible();
});

test("auto region proposals show the tier pill, the scale and accept with Enter or discard with Esc", async ({
  page,
}) => {
  const stage = await openAnnotate(page);
  await page.keyboard.press("u");
  await expect(stage).toHaveAttribute("data-tool", "auto");
  const bar = page.getByTestId("context-bar");
  const proposals = page.getByTestId("proposal-layer");

  await dragRegion(page);
  await expect(bar).toHaveAttribute("data-mode", "proposals");
  await expect(bar.getByTestId("model-tier")).toBeVisible();
  await expect(bar.getByTestId("proposal-scale")).toContainText(/nuclei · [\d.]+ µm/);
  await expect(bar.getByTestId("proposal-discard")).toContainText("Discard");
  await expect(bar.getByTestId("proposal-accept")).toContainText("Accept as");
  const found = Number(await bar.getAttribute("data-proposals"));
  expect(found).toBeGreaterThan(0);

  await page.keyboard.press("Enter");
  await expect(proposals).toHaveCount(0);
  await expect(page.getByTestId("polygon-shape")).toHaveCount(found);

  await dragRegion(page);
  await expect(bar).toHaveAttribute("data-mode", "proposals");
  await page.keyboard.press("Escape");
  await expect(proposals).toHaveCount(0);
  await expect(page.getByTestId("polygon-shape")).toHaveCount(found);
  await expect(stage).toHaveAttribute("data-tool", "auto");
});
