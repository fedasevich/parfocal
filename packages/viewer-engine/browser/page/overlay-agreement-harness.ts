import { Deck, OrthographicView } from "@deck.gl/core";
import {
  type AgreementKind,
  agreementColours,
  agreementKinds,
  agreementOverlays,
  type ComparisonKind,
} from "../../src/index.ts";
import { createOverlayLayerBuilder } from "../../src/overlay/deck/overlay-layers.ts";
import { deckDeviceProps } from "../../src/viv/deck-settings.ts";

export interface AgreementScene {
  readonly comparison: ComparisonKind;
  readonly only?: AgreementKind;
  readonly mono?: boolean;
}

export interface AgreementHarness {
  render(scene: AgreementScene): Promise<void>;
}

declare global {
  interface Window {
    agreementHarness: AgreementHarness;
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

const layouts: Record<ComparisonKind, ReadonlyArray<readonly [AgreementKind, number[]]>> = {
  "ai-vs-reviewed": [
    ["both", box(10, 10, 48, 40)],
    ["only-a", box(68, 10, 44, 40)],
    ["only-b", box(10, 66, 48, 44)],
    ["both", box(72, 70, 36, 36)],
  ],
  "model-vs-model": [
    ["only-a", box(10, 10, 48, 40)],
    ["both", box(68, 10, 44, 40)],
    ["both", box(10, 66, 48, 44)],
    ["only-b", box(72, 70, 36, 36)],
  ],
  "reviewer-vs-reviewer": [
    ["both", box(10, 10, 48, 40)],
    ["only-b", box(68, 10, 44, 40)],
    ["only-a", box(10, 66, 48, 44)],
    ["only-a", box(72, 70, 36, 36)],
  ],
};

const grey = [128, 128, 128, 255] as const;

let deck: Deck<OrthographicView> | null = null;

async function render(scene: AgreementScene): Promise<void> {
  deck?.finalize();
  document.body.replaceChildren();
  const canvas = document.createElement("canvas");
  canvas.id = "scene";
  canvas.style.width = `${viewSize}px`;
  canvas.style.height = `${viewSize}px`;
  canvas.style.display = "block";
  document.body.append(canvas);

  const objects = layouts[scene.comparison]
    .map(([agreement, ring], index) => ({ id: `O${index}`, ring, agreement }))
    .filter((object) => scene.only === undefined || object.agreement === scene.only);
  const mono = Object.fromEntries(agreementKinds.map((kind) => [kind, grey])) as Record<
    AgreementKind,
    readonly [number, number, number, number]
  >;
  const drawn = agreementOverlays({
    id: scene.comparison,
    objects,
    colours: scene.mono ? mono : agreementColours,
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
  await new Promise((resolve) => setTimeout(resolve, 150));
  deck.redraw("agreement");
  await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
}

window.agreementHarness = { render };
