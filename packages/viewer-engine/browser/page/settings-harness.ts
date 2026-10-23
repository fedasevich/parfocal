import { Deck, OrthographicView } from "@deck.gl/core";
import { ColorPaletteExtension, XRLayer } from "@hms-dbmi/viv";
import {
  deckDeviceProps,
  installUint8TextureUpload,
  stableSelections,
  unpickableLayerProps,
} from "../../src/viv/deck-settings.ts";
import { disposeDeck } from "../../src/viv/dispose-deck.ts";

export interface ChannelScene {
  readonly interpolation: "nearest" | "linear";
}

export interface SceneReport {
  readonly textureFormats: readonly string[];
  readonly antialias: boolean | null;
  readonly samples: number | null;
}

export interface SettingsHarness {
  readonly uint8: "r8unorm" | "stock";
  readonly prototypes: { deck: object; canvasContext: object | null };
  renderChannels(scene: ChannelScene): Promise<SceneReport>;
  disposeBeforeDevice(mode: "wrapper" | "finalize"): Promise<void>;
}

declare global {
  interface Window {
    settingsHarness: SettingsHarness;
  }
}

interface DeviceLike {
  gl?: WebGL2RenderingContext;
  canvasContext?: object | null;
  createTexture(props: { format?: string }): unknown;
}

const size = 128;
const params = new URLSearchParams(location.search);
const uint8 = params.get("uint8") === "stock" ? "stock" : "r8unorm";
if (uint8 === "r8unorm") installUint8TextureUpload(XRLayer);

const prototypes: SettingsHarness["prototypes"] = { deck: Deck.prototype, canvasContext: null };
const view = new OrthographicView({ id: "scene", controller: false });

function channel(seed: number): Uint8Array {
  const data = new Uint8Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      data[y * size + x] = (x * 2 + y * seed + ((x >> 3) ^ (y >> 3)) * 17) % 256;
    }
  }
  return data;
}

const channels = [channel(1), channel(3)];

function waitFor(check: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (check()) resolve();
      else if (performance.now() > deadline) reject(new Error("Timed out"));
      else requestAnimationFrame(poll);
    };
    poll();
  });
}

function mountCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.id = "scene";
  canvas.style.width = `${size * 2}px`;
  canvas.style.height = `${size * 2}px`;
  canvas.style.display = "block";
  document.querySelector("#scene")?.remove();
  document.body.append(canvas);
  return canvas;
}

async function renderChannels(scene: ChannelScene): Promise<SceneReport> {
  const canvas = mountCanvas();
  const textureFormats: string[] = [];
  let device: DeviceLike | null = null;
  let drawn = 0;
  const layer = new XRLayer({
    id: `channels-${scene.interpolation}`,
    channelData: { data: channels, width: size, height: size },
    bounds: [0, 0, size, size],
    dtype: "Uint8",
    interpolation: scene.interpolation,
    contrastLimits: [
      [0, 255],
      [30, 200],
    ],
    channelsVisible: [true, true],
    selections: stableSelections(channels, [{ c: 0 }, { c: 1 }]),
    colors: [
      [255, 0, 255],
      [0, 255, 0],
    ],
    extensions: [new ColorPaletteExtension()],
    ...unpickableLayerProps,
  } as never);
  new Deck<OrthographicView>({
    canvas,
    deviceProps: deckDeviceProps,
    views: view,
    viewState: { target: [size / 2, size / 2, 0], zoom: 1 },
    width: size * 2,
    height: size * 2,
    useDevicePixels: 1,
    layers: [layer],
    onDeviceInitialized: (created) => {
      device = created as unknown as DeviceLike;
      const createTexture = device.createTexture.bind(device);
      device.createTexture = (props) => {
        textureFormats.push(props.format ?? "unknown");
        return createTexture(props);
      };
    },
    onAfterRender: () => {
      drawn += 1;
    },
  });
  await waitFor(() => drawn >= 2 && textureFormats.length > 0, 10_000);
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const shown = device as DeviceLike | null;
  const gl = shown?.gl ?? null;
  return {
    textureFormats,
    antialias: gl?.getContextAttributes()?.antialias ?? null,
    samples: gl ? Number(gl.getParameter(gl.SAMPLES)) : null,
  };
}

async function disposeBeforeDevice(mode: "wrapper" | "finalize"): Promise<void> {
  const known = mountCanvas();
  let ready = false;
  const first = new Deck<OrthographicView>({
    canvas: known,
    deviceProps: deckDeviceProps,
    views: view,
    viewState: { target: [0, 0, 0], zoom: 0 },
    onDeviceInitialized: (created) => {
      const canvasContext = (created as unknown as DeviceLike).canvasContext;
      if (canvasContext) prototypes.canvasContext = Object.getPrototypeOf(canvasContext) as object;
      ready = true;
    },
  });
  await waitFor(() => ready, 10_000);
  disposeDeck(first, known);
  const canvas = mountCanvas();
  const early = new Deck<OrthographicView>({
    canvas,
    deviceProps: deckDeviceProps,
    views: view,
    viewState: { target: [0, 0, 0], zoom: 0 },
  });
  if (mode === "wrapper") {
    disposeDeck(early, canvas);
  } else {
    early.finalize();
    canvas.remove();
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
}

window.settingsHarness = { uint8, prototypes, renderChannels, disposeBeforeDevice };
