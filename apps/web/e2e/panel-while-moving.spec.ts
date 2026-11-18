import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const tumor044 = "00000000-0000-4000-8005-000000000005";
const rt14 = "00000000-0000-4000-8007-000000000014";

test.use({ viewport: { width: 1440, height: 900 } });

const live = `/projects/${p07}/slides/${tumor044}/live?workspace=review&as=DH`;
const full = `/projects/${p07}/slides/${tumor044}?task=${rt14}&as=DH`;

async function choosePanelWhileMoving(page: Page, name: "Hides while panning" | "Stays put") {
  await page.goto("/settings/layout");
  const choice = page
    .getByRole("dialog", { name: "Settings" })
    .getByRole("radiogroup", { name: "Panel while moving" })
    .getByRole("radio", { name });
  await choice.click();
  await expect(choice).toBeChecked();
}

async function panAndWatch(page: Page, url: string) {
  await page.goto(url);
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 20_000 });
  const dock = page.getByTestId("inspector-dock");
  await expect(dock).toBeVisible();
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0, width: 800, height: 600 };
  await page.mouse.move(box.x + 300, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(box.x + 420, box.y + 360, { steps: 8 });
  await expect(dock).toHaveAttribute("data-hidden-while-panning", "true");
  await expect.poll(async () => (await dock.boundingBox())?.width ?? 0).toBeLessThan(2);
  await page.mouse.up();
  await expect(dock).not.toHaveAttribute("data-hidden-while-panning", "true");
  await expect.poll(async () => (await dock.boundingBox())?.width ?? 0).toBeGreaterThan(200);
}

test("Hides while panning chosen in Settings hides the side panel during a pan in the live viewer", async ({
  page,
}) => {
  await choosePanelWhileMoving(page, "Hides while panning");
  await panAndWatch(page, live);
});

test("Hides while panning chosen in Settings hides the side panel during a pan in the full viewer", async ({
  page,
}) => {
  await choosePanelWhileMoving(page, "Hides while panning");
  await panAndWatch(page, full);
});

test("Stays put keeps the side panel open during a pan", async ({ page }) => {
  await choosePanelWhileMoving(page, "Stays put");
  await page.goto(live);
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 20_000 });
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0, width: 800, height: 600 };
  await page.mouse.move(box.x + 300, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(box.x + 420, box.y + 360, { steps: 8 });
  await expect(page.getByTestId("inspector-dock")).not.toHaveAttribute(
    "data-hidden-while-panning",
    "true",
  );
  await page.mouse.up();
});

test("a trackpad scroll that pans also hides the side panel and brings it back", async ({
  page,
}) => {
  await choosePanelWhileMoving(page, "Hides while panning");
  await page.goto(live);
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 20_000 });
  const dock = page.getByTestId("inspector-dock");
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0, width: 800, height: 600 };
  await page.mouse.move(box.x + 300, box.y + 300);
  for (let step = 0; step < 6; step += 1) {
    await page.mouse.wheel(1, 2);
    await page.waitForTimeout(30);
  }
  await expect(dock).toHaveAttribute("data-hidden-while-panning", "true");
  await expect(dock).not.toHaveAttribute("data-hidden-while-panning", "true");
  await expect.poll(async () => (await dock.boundingBox())?.width ?? 0).toBeGreaterThan(200);
});
