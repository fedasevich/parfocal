import { Deck, OrthographicView } from "@deck.gl/core";
import { createVectorOverlay, polygonBatchFromRings } from "../../src/index.ts";
import { createOverlayLayerBuilder } from "../../src/overlay/deck/overlay-layers.ts";
import { deckDeviceProps } from "../../src/viv/deck-settings.ts";

export interface HolesHarness {
  render(): Promise<{ triangles: number }>;
}

declare global {
  interface Window {
    holesHarness: HolesHarness;
  }
}

const viewSize = 240;
const world = 120;

const outer = [10, 10, 110, 10, 110, 110, 10, 110];
const hole = [30, 30, 30, 90, 90, 90, 90, 30];
const island = [50, 50, 70, 50, 70, 70, 50, 70];

async function render(): Promise<{ triangles: number }> {
  const canvas = document.createElement("canvas");
  canvas.id = "scene";
  canvas.style.width = `${viewSize}px`;
  canvas.style.height = `${viewSize}px`;
  canvas.style.display = "block";
  document.body.append(canvas);

  const polygons = polygonBatchFromRings([
    { ring: outer, holes: [hole], color: [30, 120, 220, 255] },
    { ring: island, color: [220, 80, 40, 255] },
  ]);
  const overlay = createVectorOverlay({
    id: "holes",
    kind: "human-annotations",
    shapes: { polygons },
    style: { fillOpacity: 1 },
  });
  const layers = createOverlayLayerBuilder().build([overlay]);

  let ready: () => void = () => {};
  const painted = new Promise<void>((resolve) => {
    ready = resolve;
  });
  new Deck<OrthographicView>({
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
  return { triangles: polygons.indices.length / 3 };
}

window.holesHarness = { render };
