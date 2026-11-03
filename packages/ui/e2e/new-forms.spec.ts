import { expect, type Page, test } from "@playwright/test";

const story = (id: string) => `/iframe.html?id=${id}&viewMode=story&globals=a11y.manual:!true`;
const submitted = async (page: Page) =>
  JSON.parse((await page.getByTestId("submitted").textContent()) ?? "null") as Record<
    string,
    unknown
  >;

test("New project asks for a name before it creates", async ({ page }) => {
  await page.goto(story("components-new-project-and-case--new-project"));
  await page.getByRole("button", { name: "Create and upload" }).click();
  await expect(page.getByText("Give the project a name.")).toBeVisible();
  await expect(page.getByTestId("submitted")).toHaveText("nothing submitted");
});

test("New project starts de-identified with the staging template and its classes", async ({
  page,
}) => {
  await page.goto(story("components-new-project-and-case--new-project"));
  await expect(page.getByRole("radio", { name: /^De-identified/ })).toBeChecked();
  await expect(page.getByRole("radio", { name: /^Sentinel node staging/ })).toBeChecked();
  await expect(page.getByTestId("class-list")).toContainText("Tumor");
  await page.getByRole("textbox").fill("  Model B validation ");
  await page.getByRole("button", { name: "Create and upload" }).click();
  expect(await submitted(page)).toEqual({
    name: "Model B validation",
    privacy: "de-identified",
    template: "sentinel-node",
    taxonomy: "sentinel-node",
  });
});

test("New project in clinical mode with the cell review template and a picked class list", async ({
  page,
}) => {
  await page.goto(story("components-new-project-and-case--new-project"));
  await page.getByRole("textbox").fill("Lymph nodes 2027");
  await page.getByRole("radio", { name: /^Clinical/ }).click();
  await page.getByRole("radio", { name: /^Cell review/ }).click();
  await expect(page.getByRole("radio", { name: /^PanNuke/ })).toBeChecked();
  await expect(page.getByTestId("class-list")).toContainText("Neoplastic");
  await expect(page.getByTestId("class-list")).not.toContainText("Tumor");
  await page.getByRole("radio", { name: "Sentinel node", exact: true }).click();
  await expect(page.getByTestId("class-list")).toContainText("Tumor");
  await page.getByRole("button", { name: "Create and upload" }).click();
  expect(await submitted(page)).toEqual({
    name: "Lymph nodes 2027",
    privacy: "clinical",
    template: "cell-review",
    taxonomy: "sentinel-node",
  });
});

test("New case in a de-identified project has no patient fields", async ({ page }) => {
  await page.goto(story("components-new-project-and-case--new-case-deidentified"));
  const patient = page.getByTestId("case-patient");
  await expect(patient).toContainText("Off in a de-identified project");
  await expect(patient.getByRole("textbox")).toHaveCount(0);
  await page.getByRole("button", { name: "Create case" }).click();
  await expect(page.getByText("Give the case an ID.")).toBeVisible();
  await page.getByLabel("Case ID").fill("S26-04830");
  await page.getByLabel("Specimen").fill("Sentinel lymph node, left");
  await page.getByRole("button", { name: "Create case" }).click();
  expect(await submitted(page)).toEqual({
    label: "S26-04830",
    specimen: "Sentinel lymph node, left",
    patient: null,
  });
});

test("New case in a clinical project shows optional patient fields", async ({ page }) => {
  await page.goto(story("components-new-project-and-case--new-case-clinical"));
  const patient = page.getByTestId("case-patient");
  await expect(patient).toContainText("optional");
  await expect(patient).toContainText("This is a clinical project");
  await page.getByLabel("Case ID").fill("S26-04831");
  await page.getByRole("button", { name: "Create case" }).click();
  expect((await submitted(page)).patient).toBeNull();

  await patient.getByLabel("Birth number").fill("FAKE-0001");
  await page.getByRole("button", { name: "Create case" }).click();
  await expect(patient).toContainText("Add the patient's name, or clear the birth number.");

  await patient.getByLabel("Name").fill("Fake Patient One");
  await page.getByRole("button", { name: "Create case" }).click();
  expect((await submitted(page)).patient).toEqual({
    name: "Fake Patient One",
    birthNumber: "FAKE-0001",
  });
});
