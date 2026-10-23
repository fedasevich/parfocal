import type { Page } from "@playwright/test";
import {
  frameToBase64,
  type ReferenceScene,
  renderReferenceScene,
  syntheticHeTile,
} from "../src/index.ts";
import type { SlideFormat } from "../src/tolerances.ts";

export interface GoldenScene {
  readonly name: string;
  readonly format: SlideFormat;
  readonly view: Pick<
    ReferenceScene,
    "canvasWidth" | "canvasHeight" | "scale" | "offsetX" | "offsetY" | "filter"
  >;
}

export const tile = syntheticHeTile(256);

export const SCENES: readonly GoldenScene[] = [
  {
    name: "synthetic-1x-nearest",
    format: "synthetic",
    view: {
      canvasWidth: 256,
      canvasHeight: 256,
      scale: 1,
      offsetX: 0,
      offsetY: 0,
      filter: "nearest",
    },
  },
  {
    name: "synthetic-2x-nearest",
    format: "synthetic",
    view: {
      canvasWidth: 384,
      canvasHeight: 256,
      scale: 2,
      offsetX: -64,
      offsetY: -32,
      filter: "nearest",
    },
  },
  {
    name: "synthetic-half-linear",
    format: "synthetic",
    view: {
      canvasWidth: 160,
      canvasHeight: 160,
      scale: 0.5,
      offsetX: 16,
      offsetY: 16,
      filter: "linear",
    },
  },
  {
    name: "synthetic-fractional-linear",
    format: "synthetic",
    view: {
      canvasWidth: 320,
      canvasHeight: 240,
      scale: 1.37,
      offsetX: -20.25,
      offsetY: -10.5,
      filter: "linear",
    },
  },
];

export interface RenderOptions {
  readonly channelOrder?: "rgb" | "bgr";
  readonly drawTile?: boolean;
}

export async function renderScene(
  page: Page,
  scene: GoldenScene,
  options: RenderOptions = {},
): Promise<string> {
  await page.setContent("<!doctype html><html><body></body></html>");
  const referenceScene: ReferenceScene = {
    ...scene.view,
    tileWidth: tile.width,
    tileHeight: tile.height,
    tileBase64: frameToBase64(tile),
    channelOrder: options.channelOrder ?? "rgb",
    drawTile: options.drawTile ?? true,
    background: [242, 242, 242],
  };
  return page.evaluate(renderReferenceScene, referenceScene);
}
