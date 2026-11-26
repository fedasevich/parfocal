import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const storage = "http://127.0.0.1:9161/e2e";
const addedSetId = "00000000-0000-4000-8009-0000000000a6";
const stromaId = "00000000-0000-4000-8003-000000000007-class-2";

const square = (x: number, y: number, side: number) => [
  [
    [x, y],
    [x + side, y],
    [x + side, y + side],
    [x, y + side],
    [x, y],
  ],
];

const regions = JSON.stringify({
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "Polygon", coordinates: square(400, 300, 200) },
      properties: { classification: { name: "Tumor" } },
    },
    {
      type: "Feature",
      geometry: { type: "Polygon", coordinates: square(900, 500, 150) },
      properties: { classification: { name: "Stroma" } },
    },
  ],
});

const cells = "x,y,class\n1200,800,Tumor\n1260,820,Epithelium\n1300,900,Tumor\n";

const classesUnknown = {
  upload_id: "up-1",
  readable: 3,
  problems: [
    {
      code: "classes-unknown",
      message: "These classes are not in the project yet. Map them once.",
      count: 1,
      places: [],
      names: ["Epithelium"],
      guess: null,
      guesses: [],
    },
  ],
};

type Fake = {
  statuses: Record<string, unknown>;
  chosen: unknown[];
  left: string[];
  sets: unknown[];
  problems?: unknown;
};

async function fakeStorage(page: Page) {
  const bodies = new Map<string, Buffer>();
  const cors = (origin: string) => ({
    "access-control-allow-origin": origin,
    "access-control-allow-credentials": "true",
    "access-control-allow-headers": "*",
    "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
    "access-control-expose-headers": "ETag, Location",
  });
  const created: { filename: string; type: string; metadata: Record<string, unknown> }[] = [];
  await page.context().route(`${storage}/**`, async (route) => {
    const request = route.request();
    const headers = cors(request.headers()["origin"] ?? "*");
    const path = new URL(request.url()).pathname.replace("/e2e", "");
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    if (request.method() === "GET" && path === "/uploads/open")
      return route.fulfill({ status: 200, headers, json: null });
    if (request.method() === "POST" && path === "/uploads/s3/multipart") {
      created.push(request.postDataJSON() as (typeof created)[number]);
      return route.fulfill({
        status: 201,
        headers,
        json: {
          key: "t/x/quarantine/1/file",
          uploadId: "up-1",
          part_size: 16777216,
          part_count: 1,
        },
      });
    }
    if (request.method() === "GET" && /\/uploads\/s3\/multipart\/[^/]+\/\d+$/.test(path))
      return route.fulfill({
        status: 200,
        headers,
        json: { url: `${storage}/part/up-1`, expires: 900 },
      });
    if (request.method() === "GET" && path.startsWith("/uploads/s3/multipart/"))
      return route.fulfill({ status: 200, headers, json: [] });
    if (request.method() === "PUT" && path.startsWith("/part/")) {
      bodies.set("up-1", request.postDataBuffer() ?? Buffer.alloc(0));
      return route.fulfill({ status: 200, headers: { ...headers, etag: '"abc"' }, body: "" });
    }
    if (request.method() === "POST" && path.endsWith("/complete"))
      return route.fulfill({
        status: 200,
        headers,
        json: { location: "/jobs/1", key: "k", uploadId: "up-1", job_id: "j", etag: "abc" },
      });
    return route.fulfill({ status: 200, headers, json: {} });
  });
  return { bodies, created };
}

async function seedFake(page: Page, extra: Partial<Fake> = {}) {
  await page.addInitScript((seed) => {
    (window as unknown as { __parfocalFake: unknown }).__parfocalFake = {
      statuses: { "up-1": { kind: "result", status: "processing", reason: null, message: null } },
      chosen: [],
      left: [],
      sets: [],
      ...seed,
    };
  }, extra);
}

async function openSlide(page: Page) {
  await page.goto(`/projects/${p07}?tab=slides`);
  const row = page.getByTestId("slide-row").filter({ hasText: "tumor_044" });
  await row.getByRole("button", { name: "Open" }).click();
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
  await expect(page.getByTestId("result-set-layers")).toBeVisible();
  return { stage, slideId: /slides\/([^/?]+)/.exec(page.url())?.[1] ?? "" };
}

async function dropOnStage(page: Page, files: { name: string; text: string }[]) {
  await page.evaluate((dropped) => {
    const transfer = new DataTransfer();
    for (const file of dropped) transfer.items.add(new File([file.text], file.name));
    const target = document.querySelector('[data-testid="slide-host"]');
    if (target === null) throw new Error("No slide host");
    target.dispatchEvent(
      new DragEvent("dragover", { dataTransfer: transfer, bubbles: true, cancelable: true }),
    );
    target.dispatchEvent(
      new DragEvent("drop", { dataTransfer: transfer, bubbles: true, cancelable: true }),
    );
  }, files);
}

const fakeOf = (page: Page) =>
  page.evaluate(() => (window as unknown as { __parfocalFake: Fake }).__parfocalFake);

async function makeReady(page: Page, slideId: string, sourceFile: string) {
  await page.evaluate(
    ({ id, slide, source }) => {
      const fake = (window as unknown as { __parfocalFake: Fake }).__parfocalFake;
      fake.sets = [
        {
          id,
          project_id: "00000000-0000-4000-8003-000000000007",
          slide_id: slide,
          name: "CSV import",
          model_version: null,
          source: "import",
          source_file: source,
          produced_at: null,
          status: "ready",
          error_code: null,
          cell_count: 3,
          region_count: 0,
          zone_count: 0,
          created_by_user_id: null,
          created_at: "2026-11-15T09:00:00+01:00",
        },
      ];
      fake.statuses["up-1"] = {
        kind: "result",
        status: "ready",
        slide_id: slide,
        result_set_id: id,
        upload_status: "completed",
      };
    },
    { id: addedSetId, slide: slideId, source: sourceFile },
  );
}

test("a GeoJSON dropped on the slide is previewed, shifted and scaled, and cancelled with no upload", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const storageCalls = await fakeStorage(page);
  await seedFake(page);
  await openSlide(page);
  const rows = page.getByTestId("result-set-layer");
  const before = await rows.count();

  await dropOnStage(page, [
    { name: "a.geojson", text: regions },
    { name: "b.csv", text: cells },
  ]);
  const panel = page.getByTestId("add-result-set-panel");
  await expect(panel.getByTestId("add-result-refused")).toContainText("one result file at a time");
  await expect(panel.getByTestId("add-result-target")).toContainText(/^To (this )?slide/);

  await dropOnStage(page, [{ name: "tumor_044_model.geojson", text: regions }]);
  const preview = page.getByTestId("result-preview-layer");
  await expect(preview).toHaveAttribute("data-objects", "2");
  const shapes = page.getByTestId("result-preview-shape");
  await expect(shapes).toHaveCount(2);
  await expect(panel.getByTestId("add-result-summary")).toContainText("2 objects");

  const firstX = async () =>
    Number(((await shapes.first().getAttribute("points")) ?? "").split(/[ ,]/)[0]);
  const unmoved = await firstX();
  await panel.getByLabel("Shift x").fill("120");
  await panel.getByLabel("Shift y").fill("-40");
  await expect(preview).toHaveAttribute("data-shift", "120,-40");
  expect(await firstX()).not.toBe(unmoved);
  await panel.getByLabel("Scale").fill("1.5");
  await expect(preview).toHaveAttribute("data-scale", "1.5");

  await panel.getByTestId("add-result-cancel").click();
  await expect(panel).toHaveCount(0);
  await expect(preview).toHaveCount(0);
  await expect(rows).toHaveCount(before);
  expect(storageCalls.created).toHaveLength(0);
});

test("a GeoJSON chosen in the card is saved with its alignment and listed in Layers", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const storageCalls = await fakeStorage(page);
  await seedFake(page);
  const { stage, slideId } = await openSlide(page);
  const rows = page.getByTestId("result-set-layer");
  const before = await rows.count();

  await page.getByTestId("add-result-set").click();
  const panel = page.getByTestId("add-result-set-panel");
  await expect(panel.getByTestId("add-result-drop")).toBeVisible();
  await expect(panel.getByTestId("add-result-save")).toBeDisabled();
  await page.getByTestId("add-result-file").setInputFiles({
    name: "tumor_044_model.geojson",
    mimeType: "application/geo+json",
    buffer: Buffer.from(regions),
  });
  const preview = page.getByTestId("result-preview-layer");
  await expect(preview).toHaveAttribute("data-objects", "2");
  await panel.getByLabel("Shift x").fill("120");
  await panel.getByLabel("Shift y").fill("-40");
  await panel.getByLabel("Scale").fill("1.5");
  await expect(preview).toHaveAttribute("data-scale", "1.5");

  await panel.getByTestId("add-result-save").click();
  await expect(preview).toHaveCount(0);
  await expect.poll(() => storageCalls.bodies.size, { timeout: 15_000 }).toBe(1);
  expect(storageCalls.created[0]?.metadata).toMatchObject({ kind: "result", slide_id: slideId });
  const saved = JSON.parse(storageCalls.bodies.get("up-1")?.toString() ?? "{}") as {
    features: { geometry: { coordinates: number[][][] } }[];
  };
  expect(saved.features[0]?.geometry.coordinates[0]?.[0]).toEqual([720, 410]);
  expect(saved.features[1]?.geometry.coordinates[0]?.[2]).toEqual([1695, 935]);
  await expect(panel.getByTestId("add-result-progress")).toBeVisible();

  await makeReady(page, slideId, "tumor_044_model.geojson");
  await expect(rows).toHaveCount(before + 1, { timeout: 15_000 });
  await expect(panel).toHaveCount(0);
  await expect(page.getByText("tumor_044_model.geojson added")).toBeVisible();
  await expect(stage).toHaveAttribute("data-state", "ready");
});

test("a CSV of cells dropped on the slide is previewed as points, checked, mapped and imported", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const storageCalls = await fakeStorage(page);
  await seedFake(page, { problems: classesUnknown });
  const { slideId } = await openSlide(page);
  const rows = page.getByTestId("result-set-layer");
  const before = await rows.count();

  await dropOnStage(page, [{ name: "tumor_044_cells.csv", text: cells }]);
  const panel = page.getByTestId("add-result-set-panel");
  const preview = page.getByTestId("result-preview-layer");
  await expect(preview).toHaveAttribute("data-objects", "3");
  await expect(page.locator('[data-testid="result-preview-shape"][data-kind="point"]')).toHaveCount(
    3,
  );
  await expect(panel.getByTestId("add-result-fixes")).toHaveCount(0);
  await expect(rows).toHaveCount(before);

  await panel.getByTestId("add-result-save").click();
  await expect.poll(() => storageCalls.bodies.size, { timeout: 15_000 }).toBe(1);
  expect(storageCalls.created[0]?.metadata).toMatchObject({ kind: "result", slide_id: slideId });
  expect(storageCalls.bodies.get("up-1")?.equals(Buffer.from(cells))).toBe(true);
  await expect(panel.getByTestId("add-result-progress")).toBeVisible();

  await page.evaluate(() => {
    const fake = (window as unknown as { __parfocalFake: Fake }).__parfocalFake;
    fake.statuses["up-1"] = {
      kind: "result",
      status: "waiting",
      reason: "needs-choices",
      message: "Choose how to import",
    };
  });
  const choices = panel.getByTestId("add-result-choices");
  await expect(choices.getByText("These classes are not in the project yet")).toBeVisible({
    timeout: 15_000,
  });
  const importButton = choices.getByTestId("import-result");
  await expect(importButton).toBeDisabled();
  await page.getByRole("combobox", { name: "Class for Epithelium" }).click();
  await page.getByRole("option", { name: "Stroma" }).click();
  await expect(importButton).toBeEnabled();
  await importButton.click();
  await expect.poll(async () => (await fakeOf(page)).chosen).toHaveLength(1);
  const chosen = (await fakeOf(page)).chosen[0] as { class_mappings: unknown[] };
  expect(chosen.class_mappings).toEqual([{ source_name: "Epithelium", class_id: stromaId }]);

  await makeReady(page, slideId, "tumor_044_cells.csv");
  await expect(rows).toHaveCount(before + 1, { timeout: 15_000 });
  await expect(rows.filter({ hasText: "CSV import" })).toHaveCount(1);
  await expect(panel).toHaveCount(0);
  await expect(page.getByText("tumor_044_cells.csv added")).toBeVisible();
});

test("a stored heatmap is drawn on the slide and listed in Layers with colour maps", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const { slideId } = await openSlide(page);
  const setId = "00000000-0000-4000-8009-0000000000b1";
  await page.addInitScript(
    ({ id, slide }) => {
      const grid = Array.from({ length: 64 }, (_, index) => (index % 8) * 30);
      (window as unknown as { __parfocalFake: unknown }).__parfocalFake = {
        statuses: {
          "up-heat": { kind: "result", status: "ready", slide_id: slide, result_set_id: id },
        },
        chosen: [],
        left: [],
        sets: [
          {
            id,
            project_id: "00000000-0000-4000-8003-000000000007",
            slide_id: slide,
            name: "Heatmap import",
            model_version: null,
            source: "import",
            source_file: "tumor_044_heat.tif",
            produced_at: null,
            status: "ready",
            error_code: null,
            cell_count: 0,
            region_count: 0,
            zone_count: 0,
            created_by_user_id: null,
            created_at: "2026-11-15T09:00:00+01:00",
          },
        ],
        heatmaps: {
          [id]: {
            facts: { width: 8, height: 8, level: 0, downsample: 100, mpp: null, tissue_share: 0.9 },
            grid,
          },
        },
      };
    },
    { id: setId, slide: slideId },
  );
  await page.reload();
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
    timeout: 15_000,
  });
  const layer = page.getByTestId("heatmap-layer");
  await expect(layer).toHaveAttribute("data-colormap", "viridis");
  const box = await layer.boundingBox();
  expect(box?.width).toBeGreaterThan(0);
  expect(Math.abs((box?.width ?? 0) - (box?.height ?? 1))).toBeLessThan(1);
  const controls = page.getByTestId("heatmap-controls");
  await expect(controls).toBeVisible();
  await controls.getByRole("radio", { name: "inferno" }).click();
  await expect(layer).toHaveAttribute("data-colormap", "inferno");
  await controls.getByRole("switch").click();
  await expect(layer).toHaveCount(0);
});

test("a long result set name is shown in full in the Display tab", async ({ page }) => {
  test.setTimeout(90_000);
  const { slideId } = await openSlide(page);
  const name = "( InstanSeg ) Tumour bed nuclei, second pass with a long descriptive name";
  await page.addInitScript(
    ({ slide, label }) => {
      (window as unknown as { __parfocalFake: unknown }).__parfocalFake = {
        statuses: {
          "up-long": {
            kind: "result",
            status: "ready",
            slide_id: slide,
            result_set_id: "00000000-0000-4000-8009-0000000000c1",
          },
        },
        chosen: [],
        left: [],
        sets: [
          {
            id: "00000000-0000-4000-8009-0000000000c1",
            project_id: "00000000-0000-4000-8003-000000000007",
            slide_id: slide,
            name: label,
            model_version: "instanseg-v1.2.0-brightfield",
            source: "import",
            source_file: null,
            produced_at: null,
            status: "ready",
            error_code: null,
            cell_count: 0,
            region_count: 0,
            zone_count: 0,
            created_by_user_id: null,
            created_at: "2026-11-15T09:00:00+01:00",
          },
        ],
        heatmaps: {},
      };
    },
    { slide: slideId, label: name },
  );
  await page.reload();
  const shown = page.getByTestId("result-set-name").filter({ hasText: "InstanSeg" });
  await expect(shown).toBeVisible({ timeout: 15_000 });
  await expect(shown).toHaveText(name);
  const clipped = await shown.evaluate((element) => element.scrollWidth > element.clientWidth + 1);
  expect(clipped).toBe(false);
});
