export const syntheticCounts = [
  { key: "off", label: "Off", count: 0 },
  { key: "10k", label: "10k", count: 10_000 },
  { key: "100k", label: "100k", count: 100_000 },
  { key: "500k", label: "500k", count: 500_000 },
  { key: "1M", label: "1M", count: 1_000_000 },
] as const;

export type SyntheticCountKey = (typeof syntheticCounts)[number]["key"];

export const syntheticChipLabel = "Synthetic";

export type SyntheticNuclei = {
  readonly synthetic: true;
  readonly chip: typeof syntheticChipLabel;
  readonly kind: "nuclei";
  readonly seed: number;
  readonly count: number;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly radius: Float32Array;
};

export type Extent = { width: number; height: number };

export const countOf = (key: string): number =>
  syntheticCounts.find((entry) => entry.key === key)?.count ?? 0;

const mulberry32 = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export const generateNuclei = (count: number, seed: number, extent: Extent): SyntheticNuclei => {
  const random = mulberry32(seed);
  const x = new Float32Array(count);
  const y = new Float32Array(count);
  const radius = new Float32Array(count);
  for (let index = 0; index < count; index += 1) {
    x[index] = random() * extent.width;
    y[index] = random() * extent.height;
    radius[index] = 3 + random() * 4;
  }
  return { synthetic: true, chip: syntheticChipLabel, kind: "nuclei", seed, count, x, y, radius };
};

export type SyntheticField = {
  readonly synthetic: true;
  readonly chip: typeof syntheticChipLabel;
  readonly kind: "heatmap-field";
  readonly seed: number;
  readonly grid: number;
  readonly values: Float32Array;
};

export const generateField = (grid: number, seed: number): SyntheticField => {
  const random = mulberry32(seed);
  const values = new Float32Array(grid * grid);
  for (let index = 0; index < values.length; index += 1) values[index] = random();
  return { synthetic: true, chip: syntheticChipLabel, kind: "heatmap-field", seed, grid, values };
};

export type DataLayer = SyntheticNuclei | SyntheticField | { synthetic: false; kind: string };

export const chipFor = (layer: DataLayer): string | null => {
  if (!layer.synthetic) return null;
  if (layer.kind === "nuclei") return nucleiLabel(layer.count);
  return fieldChipFor(String(layer.grid));
};

export type SlideSource = "fixture" | "download" | "local";

export type CatalogueSlide = {
  name: string;
  detail: string;
  group: "format" | "big";
  source: SlideSource;
};

export const sampleCatalogue: CatalogueSlide[] = [
  {
    name: "IDR OME-Zarr",
    detail: "OME-Zarr v0.4, the default",
    group: "format",
    source: "download",
  },
  { name: "Zarr v3 shard", detail: "Zarr v3, sharded", group: "format", source: "download" },
  { name: "TIFF", detail: "Pyramidal TIFF", group: "format", source: "fixture" },
  { name: "SVS", detail: "Aperio", group: "format", source: "download" },
  { name: "SVS small", detail: "Aperio, small file", group: "format", source: "download" },
  { name: "SVS J2K rgb", detail: "Aperio, JPEG 2000 RGB", group: "format", source: "fixture" },
  { name: "SVS J2K ycc", detail: "Aperio, JPEG 2000 YCbCr", group: "format", source: "fixture" },
  { name: "NDPI", detail: "Hamamatsu", group: "format", source: "download" },
  { name: "BIF", detail: "Roche Ventana", group: "format", source: "download" },
  { name: "AVS", detail: "AVS", group: "format", source: "download" },
  { name: "SCN", detail: "Leica", group: "format", source: "fixture" },
  { name: "Philips", detail: "Philips TIFF", group: "format", source: "download" },
  { name: "Huron", detail: "Huron TIFF", group: "format", source: "download" },
  { name: "Huron raw", detail: "Huron, raw strips", group: "format", source: "download" },
  {
    name: "CAMELYON local",
    detail: "CAMELYON16 TIFF on this disk",
    group: "format",
    source: "local",
  },
  { name: "NDPI 13.6 Gpx", detail: "Hamamatsu", group: "big", source: "download" },
  { name: "NDPI 6.9 GB", detail: "Hamamatsu", group: "big", source: "download" },
  { name: "BIF 9.9 Gpx", detail: "Roche Ventana", group: "big", source: "download" },
  { name: "Philips 13 Gpx", detail: "Philips TIFF", group: "big", source: "download" },
  { name: "SCN 1 Gpx", detail: "Leica", group: "big", source: "download" },
];

export const camelyonSlides = ["T016", "T009", "T001", "T002"] as const;

export type CamelyonSlide = (typeof camelyonSlides)[number];

const nucleiLabel = (count: number): string =>
  `${syntheticChipLabel} · ${count.toLocaleString("en-US")} nuclei`;

export const nucleiChipFor = (count: number): string | null =>
  count > 0 ? nucleiLabel(count) : null;

export const fieldChipFor = (grid: string): string =>
  `${syntheticChipLabel} · ${grid} × ${grid} field`;
