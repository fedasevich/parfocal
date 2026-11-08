import { Deck, OrthographicView } from "@deck.gl/core";
import {
  createFieldMapOverlay,
  createHeatmapOverlay,
  type FieldMapKind,
  type HeatmapColormap,
  type HeatmapGrid,
  heatmapStrengthState,
  withOverlayState,
} from "../../src/index.ts";
import { createOverlayLayerBuilder } from "../../src/overlay/deck/overlay-layers.ts";
import { deckDeviceProps } from "../../src/viv/deck-settings.ts";

export interface MapScene {
  readonly map: "heatmap" | FieldMapKind;
  readonly colormap?: HeatmapColormap;
  readonly threshold?: number;
  readonly strength?: number;
}

export interface MapsHarness {
  render(scene: MapScene): Promise<void>;
}

declare global {
  interface Window {
    mapsHarness: MapsHarness;
  }
}

const viewSize = 240;
const world = 120;
const cells = 24;

const peaks = [
  { x: 7, y: 8, spread: 4.5, height: 0.95 },
  { x: 17, y: 15, spread: 3.5, height: 0.6 },
];

function gridValues(): Float32Array {
  const values = new Float32Array(cells * cells);
  for (let row = 0; row < cells; row++) {
    for (let column = 0; column < cells; column++) {
      let value = 0.02;
      for (const peak of peaks) {
        const distance = (column - peak.x) ** 2 + (row - peak.y) ** 2;
        value = Math.max(value, peak.height * Math.exp(-distance / (2 * peak.spread ** 2)));
      }
      values[row * cells + column] = value;
    }
  }
  return values;
}

const grid: HeatmapGrid = {
  width: cells,
  height: cells,
  values: gridValues(),
  area: { x: 0, y: 0, width: world, height: world },
};

function overlayOf(scene: MapScene) {
  const common = { id: scene.map, grid, smooth: false };
  const strength = scene.strength === undefined ? null : heatmapStrengthState(scene.strength);
  const base =
    scene.map === "heatmap"
      ? createHeatmapOverlay({
          ...common,
          source: { model: "synthetic", version: null },
          colormap: scene.colormap ?? "viridis",
          threshold: scene.threshold ?? 0.08,
        })
      : createFieldMapOverlay(scene.map, {
          ...common,
          ...(scene.threshold === undefined ? {} : { threshold: scene.threshold }),
        });
  return strength === null ? base : withOverlayState(base, strength);
}

let deck: Deck<OrthographicView> | null = null;

async function render(scene: MapScene): Promise<void> {
  deck?.finalize();
  document.body.replaceChildren();
  const canvas = document.createElement("canvas");
  canvas.id = "scene";
  canvas.style.width = `${viewSize}px`;
  canvas.style.height = `${viewSize}px`;
  canvas.style.display = "block";
  document.body.append(canvas);

  const layers = createOverlayLayerBuilder().build([overlayOf(scene)]);

  let ready: () => void = () => {};
  const painted = new Promise<void>((resolve) => {
    ready = resolve;
  });
  deck = new Deck<OrthographicView>({
    canvas,
    deviceProps: deckDeviceProps,
    views: new OrthographicView({ id: "scene", controller: false }),
    viewState: { target: [world / 2, world / 2, 0], zoom: Math.log2(viewSize / world) },
    width: viewSize,
    height: viewSize,
    useDevicePixels: 1,
    layers,
    onAfterRender: () => ready(),
  });
  await painted;
}

window.mapsHarness = { render };
