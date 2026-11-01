import { expect, type Page, test } from "@playwright/test";

const badge = (page: Page) => page.getByTestId("fake-data-badge");
const flow = (page: Page) => page.getByTestId("connect-model");

const scenes: { scene: string; shows: string }[] = [
  { scene: "addmodel", shows: "The outlines your server sends back show here" },
  { scene: "addtested", shows: "Follows the contract" },
  { scene: "addfail", shows: "38 cells came back without a" },
  { scene: "addmap", shows: "Who can run it" },
];

test("every Connect a model scene opens on fake data", async ({ page }) => {
  for (const { scene, shows } of scenes) {
    await page.goto(`/admin?scene=${scene}`);
    await expect(flow(page)).toHaveAttribute("data-scene", scene);
    await expect(page.getByRole("heading", { name: "Connect your own model" })).toBeVisible();
    await expect(page.getByText(shows).first()).toBeVisible();
    await expect(badge(page)).toContainText("Fake data");
  }
  await page.goto("/admin?scene=addmodel&modal=contract");
  const contract = page.getByRole("dialog", { name: "The model contract" });
  await expect(contract).toContainText("Every object needs a class and a polygon");
});

test("the prototype index opens the Connect a model scenes", async ({ page }) => {
  await page.goto("/prototype");
  const screens = page.getByRole("list", { name: "Screens" });
  await screens.getByRole("link", { name: "Admin · addfail" }).click();
  await expect(page.getByText("Not Parfocal JSON yet")).toBeVisible();
  await page.goBack();
  await screens.getByRole("link", { name: "Admin · contract" }).click();
  await expect(page.getByRole("dialog", { name: "The model contract" })).toBeVisible();
});

test("a test, then classes and access, adds the model", async ({ page }) => {
  await page.goto("/admin?scene=addmodel");
  const next = page.getByRole("button", { name: "Next: classes and access" });
  await expect(next).toBeDisabled();
  await page.getByRole("button", { name: "Read the contract" }).click();
  const contract = page.getByRole("dialog", { name: "The model contract" });
  await expect(contract).toContainText("POST https://ml.cuailab.cz/parfocal/infer");
  await contract.getByRole("button", { name: "Close" }).first().click();
  await expect(contract).toBeHidden();
  await page.getByRole("button", { name: "Test connection" }).click();
  await expect(page).toHaveURL(/scene=addtested/);
  await expect(page.getByText("2 regions, 38 cells")).toBeVisible();
  await page.getByRole("button", { name: "Try another tile" }).click();
  await expect(page.getByText("Tile from a lymph node edge")).toBeVisible();
  await expect(next).toBeEnabled();
  await next.click();
  await expect(page).toHaveURL(/scene=addmap/);
  await expect(page.getByRole("textbox", { name: "Name" })).toHaveValue("Lab HoVer-Net fork");
  await expect(page.getByText("Choose a class for")).toBeVisible();
  await page.getByRole("combobox", { name: "Class for dead" }).click();
  await page.getByRole("option", { name: "Leave out of results" }).click();
  await expect(page.getByText("Every class has a match.")).toBeVisible();
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page).toHaveURL(/scene=addtested/);
  await page.getByRole("button", { name: "Next: classes and access" }).click();
  await expect(page.getByText("Every class has a match.")).toBeVisible();
  await page.getByRole("button", { name: "Add model" }).click();
  await expect(page).toHaveURL(/section=models$/);
  await expect(page.getByText("Lab HoVer-Net fork v2.1 added.")).toBeVisible();
});

test("a failing test can be tested again and Cancel goes back to AI models", async ({ page }) => {
  await page.goto("/admin?scene=addfail");
  await expect(page.getByRole("button", { name: "Next: classes and access" })).toBeDisabled();
  await page.getByRole("button", { name: "Test again" }).click();
  await expect(page).toHaveURL(/scene=addtested/);
  await expect(page.getByText("Follows the contract")).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page).toHaveURL(/section=models$/);
  await expect(page.getByRole("heading", { name: "AI models" })).toBeVisible();
});

test("Run a model links to Connect your own model", async ({ page }) => {
  await page.goto("/prototype");
  await page
    .getByRole("list", { name: "Screens" })
    .getByRole("link", { name: /Run a model · menu/ })
    .click();
  await page.getByRole("link", { name: "Connect your own model" }).click();
  await expect(page).toHaveURL(/\/admin\?scene=addmodel/);
  await expect(page.getByRole("heading", { name: "Where it runs" })).toBeVisible();
});
