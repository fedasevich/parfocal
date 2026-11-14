import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const storage = "http://127.0.0.1:9161/e2e";
const addedSetId = "00000000-0000-4000-8009-0000000000a6";

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

async function fakeStorage(page: Page) {
  const bodies = new Map<string, Buffer>();
  const cors = (origin: string) => ({
    "access-control-allow-origin": origin,
    "access-control-allow-credentials": "true",
    "access-control-allow-headers": "*",
    "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
    "access-control-expose-headers": "ETag, Location",
  });
  const created: { filename: string; metadata: Record<string, unknown> }[] = [];
  await page.context().route(`${storage}/**`, async (route) => {
    const request = route.request();
    const headers = cors(request.headers()["origin"] ?? "*");
    const path = new URL(request.url()).pathname.replace("/e2e", "");
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    if (request.method() === "GET" && path === "/uploads/open")
      return route.fulfill({ status: 404, headers, json: { type: "no-open-upload" } });
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

async function openSlide(page: Page) {
  await page.goto(`/projects/${p07}?tab=slides`);
  const row = page.getByTestId("slide-row").filter({ hasText: "tumor_044" });
  await row.getByRole("button", { name: "Open" }).click();
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
  return stage;
}

test("a GeoJSON is previewed on the slide, shifted and scaled, saved and listed in Layers", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const storageCalls = await fakeStorage(page);
  await page.addInitScript(() => {
    (window as unknown as { __parfocalFake: unknown }).__parfocalFake = {
      statuses: {},
      chosen: [],
      left: [],
    };
  });
  const stage = await openSlide(page);
  const slideId = /slides\/([^/]+)\//.exec(page.url())?.[1] ?? "";
  const rows = page.getByTestId("result-set-layer");
  await expect(page.getByTestId("result-set-layers")).toBeVisible();
  const before = await rows.count();

  await page.getByTestId("add-result-set").click();
  const panel = page.getByTestId("add-result-set-panel");
  await expect(panel).toBeVisible();
  await page.getByTestId("add-result-file").setInputFiles({
    name: "tumor_044_model.geojson",
    mimeType: "application/geo+json",
    buffer: Buffer.from(regions),
  });
  const preview = page.getByTestId("result-preview-layer");
  await expect(preview).toHaveAttribute("data-objects", "2");
  const shapes = page.getByTestId("result-preview-shape");
  await expect(shapes).toHaveCount(2);
  await expect(rows).toHaveCount(before);

  const firstX = async () =>
    Number(((await shapes.first().getAttribute("points")) ?? "").split(/[ ,]/)[0]);
  const unmoved = await firstX();
  await panel.getByLabel("Shift x").fill("120");
  await panel.getByLabel("Shift y").fill("-40");
  await expect(preview).toHaveAttribute("data-shift", "120,-40");
  expect(await firstX()).not.toBe(unmoved);
  await panel.getByLabel("Scale").fill("1.5");
  await expect(preview).toHaveAttribute("data-scale", "1.5");

  await page.getByTestId("add-result-save").click();
  await expect.poll(() => storageCalls.bodies.size, { timeout: 15_000 }).toBe(1);
  expect(storageCalls.created[0]?.metadata).toMatchObject({ kind: "result", slide_id: slideId });
  const saved = JSON.parse(storageCalls.bodies.get("up-1")?.toString() ?? "{}") as {
    features: { geometry: { coordinates: number[][][] } }[];
  };
  expect(saved.features[0]?.geometry.coordinates[0]?.[0]).toEqual([720, 410]);
  expect(saved.features[1]?.geometry.coordinates[0]?.[2]).toEqual([1695, 935]);

  await page.evaluate(
    ({ id, slide }) => {
      const fake = (
        window as unknown as {
          __parfocalFake: { statuses: Record<string, unknown>; sets: unknown[] };
        }
      ).__parfocalFake;
      fake.sets = [
        {
          id,
          project_id: "00000000-0000-4000-8003-000000000007",
          slide_id: slide,
          name: "tumor_044_model",
          model_version: null,
          source: "import",
          source_file: "tumor_044_model.geojson",
          produced_at: null,
          status: "ready",
          error_code: null,
          cell_count: 0,
          region_count: 2,
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
    { id: addedSetId, slide: slideId },
  );
  await expect(rows).toHaveCount(before + 1, { timeout: 15_000 });
  await expect(rows.filter({ hasText: "tumor_044_model" })).toHaveCount(1);
  await expect(panel).toHaveCount(0);
  await expect(preview).toHaveCount(0);
  await expect(stage).toHaveAttribute("data-state", "ready");
});

test("a stored heatmap is drawn on the slide and listed in Layers with colour maps", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await openSlide(page);
  const slideId = /slides\/([^/]+)\//.exec(page.url())?.[1] ?? "";
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
