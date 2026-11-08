import { Deck, OrthographicView } from "@deck.gl/core";
import {
  type DrawnObject,
  type DrawSettings,
  defaultDrawSettings,
  drawObjectOverlays,
} from "../../src/index.ts";
import { createOverlayLayerBuilder } from "../../src/overlay/deck/overlay-layers.ts";
import { deckDeviceProps } from "../../src/viv/deck-settings.ts";

export interface DrawStyleHarness {
  render(
    settings: Partial<Omit<DrawSettings, "hiddenClasses">>,
    currentTint?: [number, number, number, number],
  ): Promise<{ dimmed: number; scope: number }>;
}

declare global {
  interface Window {
    drawStyleHarness: DrawStyleHarness;
  }
}

const viewSize = 240;
const world = 120;

const box = (x: number, y: number, width: number, height: number) => [
  x,
  y,
  x + width,
  y,
  x + width,
  y + height,
  x,
  y + height,
];

const objects: DrawnObject[] = [
  {
    id: "R1",
    kind: "region",
    ring: box(8, 8, 50, 40),
    className: "tumor",
    score: 0.92,
    decision: "agree",
  },
  {
    id: "R2",
    kind: "region",
    ring: box(66, 8, 46, 40),
    className: "stroma",
    score: 0.25,
    decision: "disagree",
  },
  { id: "C1", kind: "cell", ring: box(12, 62, 16, 16), className: "immune", score: 0.85 },
  {
    id: "C2",
    kind: "cell",
    ring: box(38, 62, 16, 16),
    className: "tumor",
    score: 0.55,
    decision: "unsure",
  },
  { id: "C3", kind: "cell", ring: box(64, 62, 16, 16), className: "other", score: 0.2 },
  { id: "C4", kind: "cell", ring: box(90, 62, 16, 16), className: "stroma", score: 0.7 },
  { id: "C5", kind: "cell", ring: box(25, 88, 18, 18), className: "immune", score: 0.35 },
  { id: "C6", kind: "cell", ring: box(60, 88, 18, 18), className: "tumor", score: 0.95 },
];

let deck: Deck<OrthographicView> | null = null;

async function render(
  change: Partial<Omit<DrawSettings, "hiddenClasses">>,
  currentTint?: [number, number, number, number],
): Promise<{ dimmed: number; scope: number }> {
  deck?.finalize();
  document.body.replaceChildren();
  const canvas = document.createElement("canvas");
  canvas.id = "scene";
  canvas.style.width = `${viewSize}px`;
  canvas.style.height = `${viewSize}px`;
  canvas.style.display = "block";
  document.body.append(canvas);

  const drawn = drawObjectOverlays({
    id: "objects",
    objects,
    settings: { ...defaultDrawSettings, ...change },
    current: { id: "C6", tint: currentTint ?? null },
  });
  const layers = createOverlayLayerBuilder().build(drawn.overlays);

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
  return { dimmed: drawn.belowCutoff.length, scope: drawn.scope.length };
}

window.drawStyleHarness = { render };
