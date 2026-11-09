import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const p03 = "00000000-0000-4000-8003-000000000003";

const projectScenes = ["slides", "results", "tasks", "settings", "importfail"] as const;

const uploadScenes = [
  "drop",
  "empty",
  "files",
  "link",
  "remote",
  "check",
  "allgood",
  "progress",
  "done",
  "tray",
  "viewer",
  "api",
  "dup",
  "storagefull",
  "unmatched",
  "sourceoff",
] as const;

const networkNoise = /^(Failed to load resource|\[MSW\]|ZodError)/;

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !networkNoise.test(message.text())) {
      errors.push(message.text().split("\n")[0] ?? "");
    }
  });
  return errors;
}

test("every project scene opens on fake data", async ({ page }) => {
  const errors = watchErrors(page);
  for (const scene of projectScenes) {
    await page.goto(`/projects/${p07}?scene=${scene}`);
    await expect(page.getByTestId("project-page")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Sentinel node AI evaluation" })).toBeVisible();
  }
  await page.goto(`/projects/${p07}?scene=results`);
  await expect(page.getByTestId("result-sets")).toContainText("CAMELYON tumor model");
  await page.goto(`/projects/${p07}?scene=tasks`);
  await expect(page.getByTestId("task-row")).toHaveCount(5);
  await page.goto(`/projects/${p07}?scene=importfail`);
  await expect(page.getByRole("alert")).toContainText("lab_model_v3.geojson was not imported");
  expect(errors).toEqual([]);
});

test("the slides tab folds a case open and shows a slide's result sets", async ({ page }) => {
  await page.goto(`/projects/${p07}`);
  const rows = page.getByTestId("slide-row");
  await expect(rows.first()).toContainText("A1 · H&E");
  await expect(page.getByText("s3://fnvltava-scans/…/tumor_090.tif")).toBeVisible();
  await rows
    .first()
    .getByRole("button", { name: /CAMELYON v1.0/ })
    .click();
  await expect(page).toHaveURL(/sets=/);
  await expect(page.getByTestId("result-sets")).toContainText("PathoSAM + HoVer-NeXt");
  await page.getByRole("row", { name: /Case S26-04769/ }).click();
  await expect(page.getByText("Show all 9 slides")).toBeVisible();
});

test("Add a class checks the name and key and adds the class", async ({ page }) => {
  await page.goto(`/projects/${p07}?tab=settings&modal=addcls`);
  const dialog = page.getByRole("dialog", { name: "Add a class" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: /Add class/ }).click();
  await expect(dialog).toContainText("Give the class a name.");
  await dialog.getByLabel("Name").fill("Necrosis");
  await dialog.getByLabel("Key").fill("5");
  await dialog.getByRole("button", { name: /Add class/ }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("project-classes")).toContainText("Necrosis");
});

test("new project and both new case drawers open over the project", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/projects/new");
  await expect(page.getByRole("dialog", { name: "New project" })).toContainText("P12 when created");
  await page.goto(`/projects/${p07}/cases/new`);
  await expect(page.getByTestId("case-patient")).toContainText("Off in a de-identified project");
  await page.goto(`/projects/${p03}/cases/new`);
  await expect(page.getByTestId("case-patient")).toContainText("This is a clinical project");
  expect(errors).toEqual([]);
});

for (const scene of uploadScenes) {
  test(`the ${scene} upload scene opens on fake data`, async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(`/projects/${p07}/upload?scene=${scene}`);
    if (scene === "drop") await expect(page.getByTestId("drop-overlay")).toBeVisible();
    else if (scene === "tray") await expect(page.getByTestId("project-page")).toBeVisible();
    else if (scene === "api") await expect(page.getByTestId("imports-modal")).toBeVisible();
    else if (scene === "viewer") await expect(page.getByTestId("add-result-set")).toBeVisible();
    else {
      await expect(page.getByTestId("upload-page")).toHaveAttribute("data-scene", scene);
      await expect(page.getByRole("heading", { name: "Upload slides and results" })).toBeVisible();
    }
    expect(errors).toEqual([]);
  });
}

test("the formats drawer opens as help and as a check on fake data", async ({ page }) => {
  const errors = watchErrors(page);
  for (const formats of ["help", "check"]) {
    await page.goto(`/projects/${p07}/upload?scene=files&formats=${formats}`);
    await expect(page.getByTestId("formats-drawer")).toBeVisible();
  }
  await expect(page.getByTestId("format-findings")).toContainText("Read as CSV, 18,240 rows");
  expect(errors).toEqual([]);
});

test("the formats drawer opens from the upload and from an import error and lists what works", async ({
  page,
}) => {
  const errors = watchErrors(page);
  await page.goto(`/projects/${p07}/upload?scene=files`);
  await page.getByRole("button", { name: "What files work?" }).first().click();
  const drawer = page.getByTestId("formats-drawer");
  await expect(drawer).toBeVisible();
  for (const format of [
    "Aperio SVS",
    "Hamamatsu NDPI",
    "3DHISTECH MRXS",
    "OME-TIFF",
    "Zeiss CZI",
    "Philips iSyntax",
    "DICOM WSI",
    "Parfocal JSON",
    "GeoJSON or a QuPath export",
    "CSV or TSV",
    "Masks or heatmaps",
  ]) {
    await expect(drawer).toContainText(format);
  }
  await expect(drawer.getByRole("link", { name: "Parfocal JSON" })).toHaveAttribute(
    "href",
    "/api/result-formats/parfocal-json/template",
  );
  await expect(drawer.getByRole("link", { name: "JSON Schema" })).toHaveAttribute(
    "href",
    "/api/result-formats/parfocal-json/schema",
  );
  await expect(drawer.getByTestId("error-code")).toHaveCount(10);
  await expect(drawer).toContainText("missing-field");

  await page.goto(`/projects/${p07}/upload?scene=check`);
  await page
    .getByTestId("upload-problem")
    .getByRole("button", { name: "What files work?" })
    .click();
  await expect(page.getByTestId("formats-drawer")).toContainText("bad-pattern");
  expect(errors).toEqual([]);
});

test("the search, result set and chips narrow the slide rows", async ({ page }) => {
  await page.goto(`/projects/${p07}`);
  const rows = page.getByTestId("slide-row");
  await expect(rows.first()).toBeVisible();
  const all = await rows.count();
  await page.getByLabel("Filter by slide, file or case").fill("zzz-no-such-slide");
  await expect(rows).toHaveCount(0);
  await expect(page.getByText("No slides match these filters.")).toBeVisible();
  await page.getByLabel("Filter by slide, file or case").fill("");
  await expect(rows).toHaveCount(all);
  await page.getByRole("button", { name: /^No results/ }).click();
  await expect(rows.first()).toContainText("No results yet");
  for (const text of await rows.allInnerTexts()) expect(text).toContain("No results yet");
  await page.getByRole("button", { name: /^No results/ }).click();
  await expect(rows).toHaveCount(all);
  await page.getByRole("button", { name: /^Needs review/ }).click();
  await expect(rows.first()).toBeVisible();
  for (const text of await rows.allInnerTexts()) expect(text).not.toContain("Nobody yet");
});

test("a row opens its slide", async ({ page }) => {
  await page.goto(`/projects/${p07}`);
  await page.getByTestId("slide-row").first().getByRole("button", { name: "Open" }).click();
  await expect(page).toHaveURL(/\/slides\/.+\/live/);
});

test("dropping files on the project page opens the upload", async ({ page }) => {
  await page.goto(`/projects/${p07}`);
  const transfer = await page.evaluateHandle(() => {
    const data = new DataTransfer();
    data.items.add(new File([new Uint8Array(8)], "tumor_001.svs"));
    return data;
  });
  await page.getByTestId("project-page").dispatchEvent("dragover", { dataTransfer: transfer });
  await page.getByTestId("project-page").dispatchEvent("drop", { dataTransfer: transfer });
  await expect(page).toHaveURL(/\/upload/);
});

test("an upload goes from the drop through Check to the end", async ({ page }) => {
  await page.goto(`/projects/${p07}/upload?scene=drop`);
  await page.getByTestId("drop-overlay").click();
  await expect(page.getByTestId("not-matched")).toContainText("tumor_031_prob.png");
  await page.getByTestId("upload-next").click();
  await expect(page.getByTestId("upload-problem")).toHaveCount(3);
  await page.getByRole("button", { name: "Import the other 409" }).click();
  await expect(page.getByTestId("upload-fixed")).toContainText("Imported 409 objects");
  await page.getByTestId("start-upload").click();
  await expect(page.getByTestId("upload-file-progress")).toHaveCount(6);
  await page.getByRole("button", { name: "Jump to the end" }).click();
  await expect(page.getByTestId("no-results-zone")).toBeVisible();
});
