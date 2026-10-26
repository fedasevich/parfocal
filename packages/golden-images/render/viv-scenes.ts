import type { SlideArea, SlideFormatId } from "@parfocal/viewer-engine";
import type { VivView } from "../harness/viv/protocol.ts";
import type { SlideFormat } from "../src/tolerances.ts";

export interface VivGoldenScene {
  readonly name: string;
  readonly fixture: string;
  readonly formatId: SlideFormatId;
  readonly format: SlideFormat;
  readonly view: VivView;
  readonly tissue?: SlideArea;
}

export const cmu1TissueCentre = { x: 28_750, y: 10_700 };

export const cmu1MicronsPerPixel = 0.499;

export const cmu1TissueBox: SlideArea = { x: 10_000, y: 2_000, width: 32_000, height: 22_000 };

export const VIV_TISSUE_SCENE: VivGoldenScene = {
  name: "viv-cmu-1-svs-tissue-fit",
  fixture: "CMU-1.svs",
  formatId: "aperio-svs",
  format: "svs-jpeg",
  view: { kind: "fit" },
  tissue: cmu1TissueBox,
};

export const VIV_SCENES: readonly VivGoldenScene[] = [
  {
    name: "viv-cmu-1-svs-fit",
    fixture: "CMU-1.svs",
    formatId: "aperio-svs",
    format: "svs-jpeg",
    view: { kind: "fit" },
  },
  {
    name: "viv-cmu-1-svs-10x",
    fixture: "CMU-1.svs",
    formatId: "aperio-svs",
    format: "svs-jpeg",
    view: { kind: "magnification", magnification: 10, ...cmu1TissueCentre },
  },
  {
    name: "viv-cmu-1-svs-40x",
    fixture: "CMU-1.svs",
    formatId: "aperio-svs",
    format: "svs-jpeg",
    view: { kind: "magnification", magnification: 40, ...cmu1TissueCentre },
  },
];

export const cmu1TileSize = 256;

export const cmu1TileCorner = {
  x: Math.round(cmu1TissueCentre.x / cmu1TileSize) * cmu1TileSize,
  y: Math.round(cmu1TissueCentre.y / cmu1TileSize) * cmu1TileSize,
};

export const VIV_80X_SCENE: VivGoldenScene = {
  name: "viv-cmu-1-svs-80x",
  fixture: "CMU-1.svs",
  formatId: "aperio-svs",
  format: "svs-jpeg",
  view: { kind: "magnification", magnification: 80, ...cmu1TissueCentre },
};

export const VIV_TILE_CORNER_SCENE: VivGoldenScene = {
  name: "viv-cmu-1-svs-tile-corner-4x",
  fixture: "CMU-1.svs",
  formatId: "aperio-svs",
  format: "svs-jpeg",
  view: { kind: "camera", ...cmu1TileCorner, zoom: 2 },
};
