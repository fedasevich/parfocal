import { expect, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const address = "https://data.example.org/scans/";

test("slides from a link are listed, one already in the project is left out, and the rest are imported", async ({
  page,
}) => {
  const imported: unknown[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/link-imports")) {
      imported.push(request.postDataJSON());
    }
  });
  await page.goto(`/projects/${p07}/upload`);
  await expect(page.getByTestId("upload-page")).toHaveAttribute("data-scene", "empty", {
    timeout: 20_000,
  });
  await page.getByRole("radio", { name: "From a link or storage" }).click();
  const panel = page.getByTestId("link-import");
  await expect(panel.getByRole("button", { name: "Check" })).toBeDisabled();
  await panel.getByLabel("Address").fill(address);
  await panel.getByRole("button", { name: "Check" }).click();

  await expect(panel.getByLabel("Include tumor_090.tif")).toBeChecked();
  await expect(panel.getByLabel("Include tumor_031.tif")).toBeDisabled();
  await expect(panel.getByText("already in P07")).toBeVisible();
  await panel.getByLabel("Include tumor_092.tif").click();
  await expect(panel.getByText("2 of 4 slides")).toBeVisible();

  await panel.getByRole("button", { name: "Import 2 slides" }).click();
  await expect(panel.getByRole("status")).toContainText("The server is fetching 2 files");
  expect(imported).toEqual([{ address, names: ["tumor_090.tif", "tumor_091.tif"] }]);
});

test("slides are imported from a saved source without the browser ever holding its address or keys", async ({
  page,
}) => {
  const imported: unknown[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/link-imports")) {
      imported.push(request.postDataJSON());
    }
  });
  await page.goto(`/projects/${p07}/upload`);
  await expect(page.getByTestId("upload-page")).toHaveAttribute("data-scene", "empty", {
    timeout: 20_000,
  });
  await page.getByRole("radio", { name: "From a link or storage" }).click();
  const panel = page.getByTestId("link-import");
  const saved = panel.getByRole("group", { name: "Saved sources" });
  await saved.getByRole("button", { name: "Vltava scanner bucket" }).click();
  await expect(saved.getByRole("button", { name: "Vltava scanner bucket" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(panel.getByLabel("Address")).toHaveValue("");

  await expect(panel.getByLabel("Include tumor_090.tif")).toBeChecked();
  await panel.getByLabel("Include tumor_092.tif").click();
  await panel.getByRole("button", { name: "Import 2 slides" }).click();
  await expect(panel.getByRole("status")).toContainText("The server is fetching 2 files");
  expect(imported).toEqual([
    {
      source_id: "00000000-0000-4000-8098-000000000001",
      names: ["tumor_090.tif", "tumor_091.tif"],
    },
  ]);
});
