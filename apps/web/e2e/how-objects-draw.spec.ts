import { expect, type Page, test } from "./a11y.ts";

async function displayScene(page: Page) {
  await page.goto("/prototype");
  const link = page
    .getByRole("list", { name: "Screens" })
    .getByRole("link", { name: "Visualize · Display panel, the task default" });
  await page.goto((await link.getAttribute("href")) ?? "");
  await expect(page.getByTestId("full-viewer")).toBeVisible();
}

const engine = (page: Page) => page.getByTestId("still-engine");

type DrawnStyle = {
  part: string;
  width: number;
  fill: number;
  dashed: boolean;
  opacity: number;
};

async function drawn(page: Page) {
  const layer = engine(page);
  await expect(layer).toHaveAttribute("data-state", "ready", { timeout: 20_000 });
  const styles = JSON.parse((await layer.getAttribute("data-styles")) ?? "[]") as DrawnStyle[];
  const colours = JSON.parse((await layer.getAttribute("data-colours")) ?? "{}") as Record<
    string,
    number[]
  >;
  return { styles, colours, main: styles.find((style) => style.part === "main") };
}

const firstColour = async (page: Page) => Object.values((await drawn(page)).colours)[0]?.join(",");

const row = (page: Page, label: string) =>
  page.locator('[data-slot="control-row"]').filter({ hasText: label });

async function pick(page: Page, label: string, option: string) {
  await row(page, label).getByRole("radio", { name: option }).click();
}

test("draw as, width and colour change how the regions draw", async ({ page }) => {
  await displayScene(page);
  await expect.poll(async () => (await drawn(page)).main?.fill).toBe(0);
  await pick(page, "Draw as", "Fill");
  await expect.poll(async () => (await drawn(page)).main?.fill).toBeGreaterThan(0);
  await pick(page, "Draw as", "Outline");
  await expect.poll(async () => (await drawn(page)).main?.fill).toBe(0);
  await pick(page, "Width", "3 px");
  await expect.poll(async () => (await drawn(page)).main?.width).toBe(3);
  await pick(page, "Width", "1 px");
  await expect.poll(async () => (await drawn(page)).main?.width).toBe(1);
  const byClass = await firstColour(page);
  await pick(page, "Color by", "Score");
  await expect.poll(() => firstColour(page)).not.toBe(byClass);
  const byScore = await firstColour(page);
  await pick(page, "Color by", "Decision");
  await expect.poll(() => firstColour(page)).not.toBe(byScore);
});

test("opacity fades the objects", async ({ page }) => {
  await displayScene(page);
  const slider = page.getByRole("slider", { name: "Opacity" });
  await slider.focus();
  await page.keyboard.press("Home");
  await expect.poll(async () => (await drawn(page)).main?.opacity).toBe(0.2);
  await page.keyboard.press("End");
  await expect.poll(async () => (await drawn(page)).main?.opacity).toBe(1);
});

test("the score cutoff draws low objects dashed and faint without changing what is in scope", async ({
  page,
}) => {
  await displayScene(page);
  await expect(engine(page)).not.toHaveAttribute("data-scope", "0");
  const scope = await engine(page).getAttribute("data-scope");
  const rows = page.getByRole("complementary", { name: "Side panel" });
  await page.getByRole("tab", { name: /Objects/ }).click();
  const listed = await rows.getByText(/^T\d/).count();
  await page.getByRole("tab", { name: "Display" }).click();
  const slider = page.getByRole("slider", { name: "Score cutoff" });
  await slider.focus();
  await page.keyboard.press("Home");
  await expect
    .poll(async () => (await drawn(page)).styles.some((s) => s.part === "below"))
    .toBe(false);
  await page.keyboard.press("End");
  await expect
    .poll(async () => (await drawn(page)).styles.find((style) => style.part === "below")?.dashed)
    .toBe(true);
  await expect(engine(page)).toHaveAttribute("data-scope", scope ?? "");
  await page.getByRole("tab", { name: /Objects/ }).click();
  await expect(rows.getByText(/^T\d/)).toHaveCount(listed);
});

test("a class can be hidden with its switch or its key and shows its count", async ({ page }) => {
  await displayScene(page);
  const classes = page.locator('[data-slot="class-visibility"]');
  const tumor = classes.locator('[data-class="Tumor"]');
  await expect(tumor).toContainText(/\d/);
  await expect(engine(page)).toHaveAttribute("data-hidden", "0");
  const toggle = classes.getByRole("switch", { name: "Show Tumor" });
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect(engine(page)).not.toHaveAttribute("data-hidden", "0");
  await toggle.focus();
  await page.keyboard.press("1");
  await expect(toggle).toBeChecked();
  await expect(engine(page)).toHaveAttribute("data-hidden", "0");
});

test("confidence shows as a number, a word, a colour or nothing", async ({ page }) => {
  await displayScene(page);
  const chip = page.locator('[data-slot="confidence-chip"]');
  const viewer = page.getByTestId("full-viewer");
  const showOnObject = async (form: string) => {
    await page.getByRole("tab", { name: "Display" }).click();
    await pick(page, "Confidence", form);
    await page.getByRole("tab", { name: /Objects/ }).click();
  };
  await showOnObject("Color");
  await page.getByRole("button", { name: /^T\d/ }).first().click();
  await expect(chip).toHaveCount(1);
  await expect(chip).toHaveAttribute("data-band", /confident|likely|unsure|doubtful/);
  await showOnObject("Number");
  await expect(chip).toHaveCount(0);
  await expect(viewer).toContainText(/\d+% sure/);
  await showOnObject("Hidden");
  await expect(chip).toHaveCount(0);
  await expect(viewer).not.toContainText(/\d+% sure/);
});
