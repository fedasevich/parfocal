import { expect, type Page, test } from "./a11y.ts";

const stored = (page: Page) =>
  page.evaluate(
    (): Record<string, unknown> =>
      JSON.parse(window.localStorage.getItem("parfocal-lab-settings") ?? "{}") as Record<
        string,
        unknown
      >,
  );

test("Ctrl+Shift+D opens the developer drawer and closes it again", async ({ page }) => {
  await page.goto("/?as=DH");
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  await page.keyboard.press("Control+Shift+D");
  await expect(page).toHaveURL(/\/developer/);
  await expect(page.getByRole("radio", { name: /Viv/ })).toBeVisible();
  await page.keyboard.press("Control+Shift+D");
  await expect(page).not.toHaveURL(/\/developer/);
});

test("?lab opens the developer drawer", async ({ page }) => {
  await page.goto("/?as=DH&lab");
  await expect(page).toHaveURL(/\/developer/);
});

test("the controls change the stored lab settings", async ({ page }) => {
  await page.goto("/developer?renderer=webgpu");
  await page.getByRole("radio", { name: "CPU Flatbush" }).click();
  await page.getByRole("radio", { name: "Linear" }).click();
  await page.getByRole("switch", { name: "Prefetch ahead of motion" }).click();
  await page.getByRole("switch", { name: "Show the motion vector" }).click();
  expect(await stored(page)).toMatchObject({
    culling: "cpu",
    interpolation: "linear",
    prefetch: false,
    motionVector: true,
  });
  await page.goto("/developer?section=hud");
  await page.getByRole("switch", { name: "Show the HUD" }).click();
  await page.goto("/developer?section=models");
  await page.getByRole("switch", { name: "Pause models while moving" }).click();
  await page.goto("/developer?section=annot");
  await page.getByRole("combobox", { name: "Count" }).click();
  await page.getByRole("option", { name: "500k" }).click();
  await page.getByRole("combobox", { name: "Mode" }).click();
  await page.getByRole("option", { name: "Dots" }).click();
  expect(await stored(page)).toMatchObject({
    hud: false,
    pauseModels: false,
    nuclei: "500k",
    detailLevel: "dots",
  });
});

test("the developer page lists real projects and its buttons act", async ({ page }) => {
  await page.goto("/developer");
  await expect(page.getByRole("heading", { name: "Developer mode", level: 1 })).toBeVisible();
  const projects = page.getByTestId("developer-projects").getByRole("button");
  await expect(projects.first()).toBeVisible();
  await expect(page.getByTestId("developer-footer")).toContainText("100,000 synthetic nuclei");
  await page
    .getByRole("radiogroup", { name: "Renderer" })
    .getByRole("radio", { name: "WebGPU" })
    .click();
  expect(await stored(page)).toMatchObject({ renderer: "webgpu" });
  await page.getByRole("button", { name: "Back to Viv" }).click();
  expect(await stored(page)).toMatchObject({ renderer: "viv" });
  await page
    .getByRole("navigation", { name: "Developer sections" })
    .getByRole("button", { name: "Benchmark" })
    .click();
  await page.getByRole("button", { name: "Run pan sweep" }).click();
  await expect(page.getByText("Open a slide in the viewer to run the pan sweep")).toBeVisible();
  await page.goto("/developer?section=job");
  await expect(page.getByRole("group").filter({ hasText: "Start" }).first()).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await page.goto("/developer");
  await projects.first().click();
  await expect(page).toHaveURL(/\/projects\//);
});

test("a doctor gets no drawer from the address or the keyboard", async ({ page }) => {
  await page.goto("/developer?as=LM");
  await expect(page.getByTestId("developer-refused")).toBeVisible();
  await page.goto("/?as=LM&lab");
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  await page.keyboard.press("Control+Shift+D");
  await expect(page).not.toHaveURL(/\/developer/);
});
