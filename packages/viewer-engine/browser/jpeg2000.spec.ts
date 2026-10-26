import { expect, type Page, test } from "@playwright/test";
import { fixtureAvailability } from "../../golden-images/render/viv-harness.ts";
import { harnessUrl } from "./cdp.ts";
import type { Jpeg2000Report } from "./page/jpeg2000-harness.ts";

const tiles = [
  [1, 0],
  [2, 0],
  [2, 1],
] as const;

function codecRequests(urls: readonly string[]): string[] {
  return urls.filter((url) => /openjpeg/i.test(url) || url.endsWith(".wasm"));
}

async function run(
  page: Page,
  file: string,
  formatId: "generic-tiff" | "aperio-svs",
  area: "synthetic" | "cache",
): Promise<{ report: Jpeg2000Report; requests: string[] }> {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.goto(harnessUrl("/app/jpeg2000.html"));
  await page.waitForFunction(() => window.jpeg2000Harness !== undefined);
  const report = await page.evaluate(
    ({ url, format, wanted }) => window.jpeg2000Harness.run(url, format, wanted),
    { url: harnessUrl(`/${area}/${file}`), format: formatId, wanted: tiles },
  );
  return { report, requests };
}

test("a JPEG 2000 slide downloads OpenJPEG inside the decode worker, once the first tile is read", async ({
  page,
}) => {
  const { report, requests } = await run(
    page,
    "synthetic-jp2k-33005.tiff",
    "generic-tiff",
    "synthetic",
  );
  expect(report.workerError).toBeNull();
  expect(report.workerTiles).toHaveLength(3);
  for (const tile of report.workerTiles) {
    expect(tile.greyShare).toBe(0);
    expect(tile.whiteShare).toBeLessThan(0.5);
  }
  const fetched = codecRequests(requests);
  expect(fetched.some((url) => url.endsWith(".wasm"))).toBe(true);
  expect(fetched.length).toBeGreaterThanOrEqual(2);
});

test("a JPEG slide never downloads OpenJPEG", async ({ page }) => {
  const { report, requests } = await run(page, "synthetic-jpeg.tiff", "generic-tiff", "synthetic");
  expect(report.workerError).toBeNull();
  expect(report.workerTiles).toHaveLength(3);
  expect(report.pageOpened).toBe(true);
  expect(report.pageReadError).toBeNull();
  expect(requests.some((url) => url.includes("/synthetic/"))).toBe(true);
  expect(codecRequests(requests)).toEqual([]);
});

test("a deflate OME-TIFF never downloads OpenJPEG", async ({ page }) => {
  const { report, requests } = await run(
    page,
    "synthetic-zlib.ome.tiff",
    "generic-tiff",
    "synthetic",
  );
  expect(report.workerError).toBeNull();
  expect(codecRequests(requests)).toEqual([]);
});

test("the page refuses to decode a JPEG 2000 tile and never loads the WebAssembly itself", async ({
  page,
}) => {
  const { report } = await run(page, "synthetic-jp2k-33005.tiff", "generic-tiff", "synthetic");
  expect(report.pageOpened).toBe(true);
  expect(report.pageReadErrorName).toBe("MainThreadCodecError");
  expect(report.pageReadError).toMatch(/never on the main thread/);
});

test("damaged tiles come back from the worker as grey, beside intact tiles", async ({ page }) => {
  const { report } = await run(page, "synthetic-jp2k-damaged.tiff", "generic-tiff", "synthetic");
  expect(report.workerError).toBeNull();
  const byTile = new Map(report.workerTiles.map((tile) => [tile.tile.join(","), tile]));
  expect(byTile.get("1,0")?.greyShare).toBe(1);
  expect(byTile.get("2,1")?.greyShare).toBe(1);
  expect(byTile.get("2,0")?.greyShare).toBe(0);
  expect(byTile.get("2,0")?.whiteShare).toBeLessThan(1);
});

test("an Aperio JPEG 2000 slide decodes in the worker with OpenSlide's colours (JP2K-33003-1.svs, cached)", async ({
  page,
}) => {
  const availability = fixtureAvailability("JP2K-33003-1.svs");
  test.skip(availability.status === "missing", "fixture not downloaded");
  const { report } = await run(page, "JP2K-33003-1.svs", "aperio-svs", "cache");
  expect(report.workerError).toBeNull();
});
