import type { TileOutline } from "../generated/api.ts";

export const labServer = {
  address: "https://ml.cuailab.cz/parfocal/infer",
  host: "ml.cuailab.cz",
  signIn: "token",
  lastFour: "3f9a",
  tileSize: 512,
  magnification: 40,
  tilesAtOnce: 4,
  healthCheckMinutes: 5,
  taxonomy: "sentinel-node",
  whoCanRun: "researchers",
  projects: ["P07", "P09"],
  software: "MONAI Label 0.8",
  sampleSlide: "tumor_009",
  model: { name: "Lab HoVer-Net fork", version: "v2.1" },
} as const;

const cell = (x: number, y: number, rx: number, ry: number, kind: string) => ({
  x,
  y,
  rx,
  ry,
  class: kind,
});

const neo = "neoplastic";
const inf = "inflammatory";
const con = "connective";

const centreTile: TileOutline = {
  regions: [
    [
      [16, 22],
      [128, 14],
      [136, 84],
      [118, 128],
      [26, 132],
    ],
    [
      [20, 136],
      [112, 138],
      [104, 184],
      [18, 182],
    ],
  ],
  cells: [
    cell(34, 44, 9, 7, neo),
    cell(62, 30, 10, 8, neo),
    cell(58, 70, 8, 7, neo),
    cell(92, 56, 9, 8, neo),
    cell(118, 34, 7, 6, inf),
    cell(146, 52, 6, 6, inf),
    cell(104, 92, 9, 7, neo),
    cell(72, 104, 10, 8, neo),
    cell(176, 40, 7, 6, inf),
    cell(206, 64, 6, 5, inf),
    cell(228, 40, 7, 6, inf),
    cell(196, 128, 12, 6, con),
    cell(234, 112, 11, 5, con),
    cell(150, 150, 12, 6, con),
    cell(40, 150, 9, 7, neo),
    cell(88, 160, 8, 7, neo),
    cell(178, 92, 6, 6, inf),
    cell(244, 166, 7, 6, inf),
  ],
};

const edgeTile: TileOutline = {
  regions: centreTile.regions.slice(1),
  cells: centreTile.cells.filter((item) => item.y > 80),
};

export const sampleTiles = [
  {
    label: "Tile from the tumor_009 centre",
    slide: "tumor_009",
    answeredMs: 412,
    regions: 2,
    cells: 38,
    classes: 5,
    outline: centreTile,
  },
  {
    label: "Tile from a lymph node edge",
    slide: "tumor_009",
    answeredMs: 380,
    regions: 1,
    cells: 22,
    classes: 3,
    outline: edgeTile,
  },
];

export const sentClasses = [
  { name: "neoplastic", cells: 21, suggested: "Tumor" },
  { name: "inflammatory", cells: 9, suggested: "Immune" },
  { name: "connective", cells: 5, suggested: "Stroma" },
  { name: "epithelial", cells: 2, suggested: "Other" },
  { name: "dead", cells: 1, suggested: null },
];

export const failedTest = { answeredMs: 380, returns: ["Cells"], missingGeometry: 38 };
