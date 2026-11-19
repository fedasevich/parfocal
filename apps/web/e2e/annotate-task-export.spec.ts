import { expect, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const annotateTask = "00000000-0000-4000-8007-000000000021";
const withResults = "00000000-0000-4000-8005-000000000005";

test.use({ viewport: { width: 1440, height: 900 } });

const formats = [
  { format: "geojson", label: "GeoJSON", file: /\.geojson$/ },
  { format: "flatgeobuf", label: "FlatGeobuf", file: /\.fgb$/ },
  { format: "parfocal", label: "Parfocal JSON", file: /\.json$/ },
];

test("the annotate task top bar exports the slide as GeoJSON, FlatGeobuf and Parfocal JSON", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto(
    `/projects/${p07}/slides/${withResults}/live?task=${annotateTask}&tab=objects&as=DH`,
  );
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
    timeout: 20_000,
  });
  for (const { format, label, file } of formats) {
    await page.getByTestId("export-menu").click();
    const item = page.getByTestId(`export-${format}`);
    await expect(item).toContainText(label);
    await expect(item.locator("small")).not.toBeEmpty();
    const download = page.waitForEvent("download");
    await item.click();
    expect((await download).suggestedFilename()).toMatch(file);
  }
});

test("the exported Parfocal JSON names its format and lists the objects", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto(
    `/projects/${p07}/slides/${withResults}/live?task=${annotateTask}&tab=objects&as=DH`,
  );
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
    timeout: 20_000,
  });
  await page.getByTestId("export-menu").click();
  const download = page.waitForEvent("download");
  await page.getByTestId("export-parfocal").click();
  const text = await (await download).createReadStream().then(
    (stream) =>
      new Promise<string>((done) => {
        const parts: Buffer[] = [];
        stream.on("data", (part: Buffer) => parts.push(part));
        stream.on("end", () => done(Buffer.concat(parts).toString("utf8")));
      }),
  );
  const parsed = JSON.parse(text) as { format: string; objects: unknown[] };
  expect(parsed.format).toBe("parfocal-results");
  expect(Array.isArray(parsed.objects)).toBe(true);
});

test("the slide More menu lists the three exports and downloads one", async ({ page }) => {
  await page.goto("/prototype");
  await page
    .getByRole("list", { name: "Screens" })
    .getByRole("link", { name: "Annotate workspace · Auto region", exact: true })
    .click();
  await page.getByRole("button", { name: "More" }).click();
  for (const label of ["Export GeoJSON", "Export FlatGeobuf", "Export Parfocal JSON"]) {
    await expect(page.getByRole("menuitem", { name: new RegExp(label) })).toBeVisible();
  }
  const download = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: /Export GeoJSON/ }).click();
  expect((await download).suggestedFilename()).toMatch(/\.geojson$/);
});
