import { expect, type Page, test } from "@playwright/test";

const story = (id: string) =>
  `/iframe.html?id=controls-tool-rail-button--${id}&viewMode=story&globals=a11y.manual:!true`;
const buttonsOf = (page: Page) => page.locator('[data-slot="tool-rail-button"]');

const look = (page: Page) =>
  buttonsOf(page)
    .first()
    .evaluate((element) => {
      const style = getComputedStyle(element);
      const dot = getComputedStyle(element, "::before");
      const badge = element.querySelector("span[aria-hidden]");
      const badgeStyle = badge ? getComputedStyle(badge) : null;
      return {
        width: element.getBoundingClientRect().width,
        height: element.getBoundingClientRect().height,
        background: style.backgroundColor,
        color: style.color,
        dot: dot.content === "none" ? null : { width: dot.width, background: dot.backgroundColor },
        badge: badge?.textContent ?? null,
        badgeColor: badgeStyle?.color ?? null,
        badgeOpacity: badgeStyle?.opacity ?? null,
        badgeSize: badgeStyle?.fontSize ?? null,
      };
    });

test("a default tool is a 38 px square with its key in the corner and no fill", async ({
  page,
}) => {
  await page.goto(story("default"));
  const button = buttonsOf(page);
  await expect(button).toHaveAccessibleName("Select (V)");
  await expect(button).toHaveAttribute("aria-pressed", "false");
  const seen = await look(page);
  expect(seen.width).toBe(38);
  expect(seen.height).toBe(38);
  expect(seen.badge).toBe("V");
  expect(seen.badgeSize).toBe("8px");
  expect(seen.background).toBe("rgba(0, 0, 0, 0)");
  expect(seen.dot).toBeNull();
});

test("the hover state lifts the background and brightens the icon", async ({ page }) => {
  await page.goto(story("default"));
  const resting = await look(page);
  await page.goto(story("hover"));
  const hovered = await look(page);
  expect(hovered.background).not.toBe("rgba(0, 0, 0, 0)");
  expect(hovered.color).not.toBe(resting.color);
});

test("the active state fills with the accent and the key turns to the on accent colour", async ({
  page,
}) => {
  await page.goto(story("active"));
  const button = buttonsOf(page);
  await expect(button).toHaveAttribute("aria-pressed", "true");
  const seen = await look(page);
  expect(seen.background).not.toBe("rgba(0, 0, 0, 0)");
  expect(seen.badgeColor).toBe(seen.color);
  expect(seen.badgeOpacity).toBe("0.8");
});

test("an AI tool carries a 5 px accent dot that turns to the on accent colour when active", async ({
  page,
}) => {
  await page.goto(story("ai-tool"));
  await expect(buttonsOf(page)).toHaveAttribute("data-ai", "true");
  const idle = await look(page);
  expect(idle.dot?.width).toBe("5px");
  await page.goto(story("ai-active"));
  const active = await look(page);
  expect(active.dot?.width).toBe("5px");
  expect(active.dot?.background).toBe(active.color);
  expect(active.dot?.background).not.toBe(idle.dot?.background);
});

test("a tool without a key shows no badge and is named by its label alone", async ({ page }) => {
  await page.goto(story("without-key"));
  await expect(buttonsOf(page)).toHaveAccessibleName("Comment");
  expect((await look(page)).badge).toBeNull();
});

test("the tooltip names the tool and its key", async ({ page }) => {
  await page.goto(story("default"));
  await buttonsOf(page).hover();
  await expect(page.locator('[data-slot="tooltip-content"]')).toHaveText("Select · V");
});

test("in a rail one tool is active at a time, by click or by keyboard", async ({ page }) => {
  await page.goto(story("rail-picks-one-tool"));
  const rail = page.getByRole("toolbar", { name: "Tools" });
  await expect(rail).toHaveAttribute("aria-orientation", "vertical");
  const select = page.getByRole("button", { name: "Select (V)" });
  const ruler = page.getByRole("button", { name: "Ruler (L)" });
  await expect(select).toHaveAttribute("aria-pressed", "true");
  await ruler.click();
  await expect(ruler).toHaveAttribute("aria-pressed", "true");
  await expect(select).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "Hand (H)" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Hand (H)" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(ruler).toHaveAttribute("aria-pressed", "false");
});
