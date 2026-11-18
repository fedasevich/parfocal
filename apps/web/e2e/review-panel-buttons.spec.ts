import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const slide = "00000000-0000-4000-8005-000000000001";
const tumor044 = "00000000-0000-4000-8005-000000000005";
const rt14 = "00000000-0000-4000-8007-000000000014";

test.describe.configure({ timeout: 90_000 });

const openLive = async (page: Page) => {
  await page.goto(`/projects/${p07}/slides/${slide}/live?task=${rt14}&as=DH`);
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
    timeout: 25_000,
  });
};

const switcher = (page: Page) => page.getByTestId("workspace-switch");

test("the Guided button starts guided review on the slide and decides an object", async ({
  page,
}) => {
  await openLive(page);
  await switcher(page).getByRole("radio", { name: "Guided" }).click();
  await expect(page).toHaveURL(/\/tasks\/.+\/guided/);
  const objects = page.getByTestId("stage-review-objects");
  await expect(objects).toHaveAttribute("data-ready", "true", { timeout: 25_000 });
  await expect(objects).toHaveAttribute("data-guided", "true");
  await expect(switcher(page).getByRole("radio", { name: "Guided" })).toBeChecked();
  const heading = objects.getByRole("heading");
  const before = (await heading.textContent()) ?? "";
  await objects.getByRole("button", { name: /Agree/ }).first().click();
  await expect(heading).not.toHaveText(before);
});

test("Full viewer leaves guided review for the full viewer", async ({ page }) => {
  await openLive(page);
  await switcher(page).getByRole("radio", { name: "Guided" }).click();
  await expect(page.getByTestId("stage-review-objects")).toHaveAttribute("data-guided", "true", {
    timeout: 25_000,
  });
  await expect(switcher(page).getByRole("radio", { name: "Guided" })).toBeChecked();
  await switcher(page).getByRole("radio", { name: "Full viewer" }).click();
  await expect(page).toHaveURL(/\/slides\//);
  await expect(page.getByTestId("stage-review-objects")).toHaveAttribute("data-guided", "false", {
    timeout: 25_000,
  });
});

test("the map buttons say what they produce and the panel's quiet buttons read as buttons", async ({
  page,
}) => {
  await page.goto(`/projects/${p07}/slides/${tumor044}/live?workspace=review&as=DH`);
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
    timeout: 30_000,
  });
  await page.getByTestId("stage-inspector").getByRole("tab", { name: "Display" }).click();
  await expect(page.getByTestId("view-map-ask")).toHaveText(/Colour tumor in this view/);
  await expect(page.getByTestId("painted-map-toggle")).toHaveText(/Brush your own map/);
  await expect(page.getByTestId("view-map-ask")).toHaveAttribute("title", /how likely/);
  await expect(page.getByTestId("painted-map-toggle")).toHaveAttribute("title", /name, save/);
});

test("the guided panel's quiet buttons have a visible border", async ({ page }) => {
  await page.goto(`/tasks/${rt14}/guided?slide=${slide}`);
  const objects = page.getByTestId("stage-review-objects");
  await expect(objects).toHaveAttribute("data-ready", "true", { timeout: 25_000 });
  for (const name of ["Next", "Previous"]) {
    const button = objects.getByRole("button", { name });
    await expect(button).toHaveCSS("border-top-width", "1px");
    await expect(button).not.toHaveCSS("border-top-color", "rgba(0, 0, 0, 0)");
  }
});
