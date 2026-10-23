import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  createDefaultPixelSourceRegistry,
  createPixelSourceRegistry,
  type OpenRequest,
  type PixelSource,
  slideFormatIds,
  UnsupportedFormatError,
} from "../../src/index.ts";

const identifyModule = new URL(
  "../../../../workers/ingest/src/parfocal_ingest/identify.py",
  import.meta.url,
);

async function ingestFormatIds(): Promise<string[]> {
  const source = await readFile(identifyModule, "utf8");
  const block = /class Format\(StrEnum\):\n((?: {4}\w+ = "[^"]+"\n)+)/.exec(source)?.[1] ?? "";
  return Array.from(block.matchAll(/= "([^"]+)"/g), (match) => match[1] ?? "");
}

test("format ids are the ingest worker's ids plus OME-Zarr", async () => {
  const ingest = await ingestFormatIds();
  assert.ok(ingest.length > 0);
  assert.deepEqual([...slideFormatIds].sort(), [...ingest, "ome-zarr"].sort());
});

test("the default registry reads tile-grid TIFFs and OME-Zarr and refuses the rest", () => {
  const registry = createDefaultPixelSourceRegistry();
  const supported = slideFormatIds.filter((formatId) => registry.supports(formatId));
  assert.deepEqual(supported, [
    "aperio-svs",
    "leica-scn",
    "philips-tiff",
    "huron-tiff",
    "argos-avs",
    "ome-tiff",
    "generic-tiff",
    "ome-zarr",
  ]);
});

test("an unregistered format is refused with its id", async () => {
  const registry = createDefaultPixelSourceRegistry();
  for (const formatId of ["hamamatsu-ndpi", "ventana-bif", "mirax", "dicom"] as const) {
    await assert.rejects(
      registry.open({ formatId, url: "http://127.0.0.1/slide" }),
      (error: unknown) => error instanceof UnsupportedFormatError && error.formatId === formatId,
    );
  }
});

test("the opener for the format id gets the request with its slide index", async () => {
  const registry = createPixelSourceRegistry();
  const seen: OpenRequest[] = [];
  const fake = { formatId: "hamamatsu-ndpi" } as PixelSource;
  registry.register(["hamamatsu-ndpi"], (request) => {
    seen.push(request);
    return Promise.resolve(fake);
  });
  const index = { formatId: "hamamatsu-ndpi", micronsPerPixel: { x: 0.46, y: 0.46 } } as const;
  const source = await registry.open({
    formatId: "hamamatsu-ndpi",
    url: "http://127.0.0.1/a.ndpi",
    index,
  });
  assert.equal(source, fake);
  assert.equal(seen[0]?.index, index);
});

test("a slide index for another format is refused", async () => {
  const registry = createDefaultPixelSourceRegistry();
  await assert.rejects(
    registry.open({
      formatId: "aperio-svs",
      url: "http://127.0.0.1/a.svs",
      index: { formatId: "ome-tiff" },
    }),
    /slide index is for ome-tiff/,
  );
});
