import { after } from "node:test";
import {
  createDefaultPixelSourceRegistry,
  type OpenRequest,
  openOmeZarrSource,
  openTiffSource,
  type SlideFormatId,
} from "../../src/index.ts";
import { type Expected, pixelSourceConformance } from "./conformance.ts";
import { cachedFixture, cachedFixtureDir, syntheticDir } from "./fixtures.ts";
import { serve } from "./serve.ts";
import { writeZarrFixture, type ZarrFixtureOptions } from "./zarr-fixture.ts";

const zarrStores: Record<string, ZarrFixtureOptions> = {
  "OME-Zarr 0.4 RGB": {
    version: 2,
    dtype: "uint8",
    channels: 3,
    width: 300,
    height: 200,
    chunk: 128,
    levels: 2,
  },
  "OME-Zarr 0.5 RGB": {
    version: 3,
    dtype: "uint8",
    channels: 3,
    width: 300,
    height: 200,
    chunk: 128,
    levels: 2,
  },
  "OME-Zarr 0.5 16-bit grey": {
    version: 3,
    dtype: "uint16",
    channels: 1,
    width: 260,
    height: 130,
    chunk: 64,
    levels: 3,
  },
  "OME-Zarr 0.4 sparse": {
    version: 2,
    dtype: "uint8",
    channels: 3,
    width: 300,
    height: 200,
    chunk: 128,
    levels: 2,
    missing: [[0, 0, 1]],
  },
};

const written = await Promise.all(
  Object.entries(zarrStores).map(
    async ([name, options]) => [name, await writeZarrFixture(options)] as const,
  ),
);

const served = await serve({
  "/synthetic": syntheticDir,
  "/cache": cachedFixtureDir(),
  ...Object.fromEntries(written.map(([, fixture], index) => [`/zarr${index}`, fixture.root])),
});

after(async () => {
  await served.close();
  await Promise.all(written.map(([, fixture]) => fixture.remove()));
});

const registry = createDefaultPixelSourceRegistry();

function viaRegistry(formatId: SlideFormatId, path: string, extra: Partial<OpenRequest> = {}) {
  return () => registry.open({ formatId, url: served.url(path), ...extra });
}

const synthetic: Expected = { levels: 3, photometric: "rgb", dtype: "uint8", micronsPerPixel: 0.5 };

pixelSourceConformance(
  "geotiff, generic YCbCr JPEG TIFF",
  viaRegistry("generic-tiff", "/synthetic/synthetic-jpeg.tiff"),
  synthetic,
);
pixelSourceConformance(
  "geotiff, OME-TIFF with SubIFDs",
  viaRegistry("ome-tiff", "/synthetic/synthetic-zlib.ome.tiff"),
  synthetic,
);
pixelSourceConformance(
  "geotiff, big-endian BigTIFF",
  viaRegistry("generic-tiff", "/synthetic/synthetic-big-endian.tiff"),
  synthetic,
);
pixelSourceConformance(
  "geotiff, sparse YCbCr TIFF",
  viaRegistry("generic-tiff", "/synthetic/synthetic-sparse.tiff"),
  synthetic,
);
pixelSourceConformance(
  "geotiff, levels and scale from a slide index",
  () =>
    openTiffSource({
      formatId: "generic-tiff",
      url: served.url("/synthetic/synthetic-jpeg.tiff"),
      index: {
        formatId: "generic-tiff",
        levels: [
          { page: 0, downsample: 1, width: 1024, height: 768 },
          { page: 2, downsample: 4, width: 256, height: 192 },
        ],
        micronsPerPixel: { x: 0.25, y: 0.25 },
      },
    }),
  { levels: 2, photometric: "rgb", dtype: "uint8", micronsPerPixel: 0.25 },
);

const rgb8 = { photometric: "rgb", dtype: "uint8" } as const;

const cachedSlides: readonly (readonly [string, SlideFormatId, Expected])[] = [
  ["CMU-1-Small-Region.svs", "aperio-svs", { ...rgb8, levels: 1, micronsPerPixel: 0.499 }],
  [
    "CMU-1.svs",
    "aperio-svs",
    {
      ...rgb8,
      levels: 3,
      micronsPerPixel: 0.499,
      levelSizes: ["1 46000x32914", "4 11500x8228", "16 2875x2057"],
    },
  ],
  [
    "CMU-1.tiff",
    "generic-tiff",
    {
      ...rgb8,
      levels: 9,
      micronsPerPixel: null,
      levelSizes: [
        "1 46000x32914",
        "2 23000x16457",
        "4 11500x8228",
        "8 5750x4114",
        "16 2875x2057",
        "32 1437x1028",
        "64 718x514",
        "128 359x257",
        "256 179x128",
      ],
    },
  ],
  [
    "tumor_009.tif",
    "philips-tiff",
    {
      ...rgb8,
      levels: 10,
      micronsPerPixel: null,
      levelSizes: [
        "1 97792x217088",
        "2 48896x108544",
        "4 24448x54272",
        "8 12224x27136",
        "16 6112x13568",
        "32 3056x6784",
        "64 1528x3392",
        "128 764x1696",
        "256 382x848",
        "512 191x424",
      ],
    },
  ],
  [
    "Philips-4.tiff",
    "philips-tiff",
    {
      ...rgb8,
      levels: 9,
      micronsPerPixel: null,
      levelSizes: [
        "1 91136x68096",
        "2 45568x34048",
        "4 22784x17024",
        "8 11392x8512",
        "16 5696x4256",
        "32 2848x2128",
        "64 1424x1064",
        "128 712x532",
        "256 356x266",
      ],
    },
  ],
  [
    "Huron-1-40x.tif",
    "huron-tiff",
    {
      ...rgb8,
      levels: 3,
      micronsPerPixel: 0.2,
      levelSizes: ["1 12040x21006", "4 3010x5252", "16 753x1313"],
    },
  ],
  [
    "Argos-1.avs",
    "argos-avs",
    {
      ...rgb8,
      levels: 8,
      micronsPerPixel: 0.38300410109301325,
      levelSizes: [
        "1 130546x57440",
        "2 65273x28720",
        "4 32636x14360",
        "8 16318x7180",
        "16 8159x3590",
        "32 4079x1795",
        "64 2039x897",
        "128 1019x448",
      ],
    },
  ],
  [
    "Leica-1.scn",
    "leica-scn",
    {
      ...rgb8,
      levels: 5,
      micronsPerPixel: 0.5,
      levelSizes: ["1 36832x38432", "4 9208x9608", "16 2302x2402", "64 576x600", "256 144x150"],
    },
  ],
];

for (const [file, formatId, expected] of cachedSlides) {
  if (cachedFixture(file) === null) continue;
  pixelSourceConformance(`geotiff, ${file}`, viaRegistry(formatId, `/cache/${file}`), expected);
}

const zarrExpected: Record<string, Expected> = {
  "OME-Zarr 0.4 RGB": { levels: 2, photometric: "rgb", dtype: "uint8", micronsPerPixel: 0.5 },
  "OME-Zarr 0.5 RGB": { levels: 2, photometric: "rgb", dtype: "uint8", micronsPerPixel: 0.5 },
  "OME-Zarr 0.5 16-bit grey": {
    levels: 3,
    photometric: "grey",
    dtype: "uint16",
    micronsPerPixel: 0.5,
  },
  "OME-Zarr 0.4 sparse": { levels: 2, photometric: "rgb", dtype: "uint8", micronsPerPixel: 0.5 },
};

for (const [index, [name]] of written.entries()) {
  const expected = zarrExpected[name];
  if (expected === undefined) continue;
  pixelSourceConformance(
    `zarrita, ${name}`,
    () => openOmeZarrSource({ formatId: "ome-zarr", url: served.url(`/zarr${index}`) }),
    expected,
  );
}
