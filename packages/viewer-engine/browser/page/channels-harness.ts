import { Deck, type Layer, OrthographicView } from "@deck.gl/core";
import { MultiscaleImageLayer } from "@hms-dbmi/viv";
import {
  createDefaultPixelSourceRegistry,
  type PixelSource,
  type SlideFormatId,
} from "../../src/index.ts";
import {
  type ChannelDisplay,
  createVivChannelLevels,
  type VivChannelLevels,
  vivChannelLayerProps,
} from "../../src/viv/index.ts";

export interface ChannelsOpened {
  readonly dtype: string;
  readonly channels: readonly string[];
  readonly ladder: readonly number[];
  readonly slide: { readonly width: number; readonly height: number };
}

export interface ChannelsShown {
  readonly errors: readonly string[];
  readonly canvas: { readonly width: number; readonly height: number };
  readonly scale: number;
}

export interface ChannelsHarness {
  open(url: string, formatId: SlideFormatId): Promise<ChannelsOpened>;
  show(display: readonly ChannelDisplay[]): Promise<ChannelsShown>;
}

declare global {
  interface Window {
    channelsHarness: ChannelsHarness;
  }
}

const registry = createDefaultPixelSourceRegistry();
const errors: string[] = [];
const view = new OrthographicView({ id: "slide", controller: false });

let deck: Deck<OrthographicView> | null = null;
let source: PixelSource | null = null;
let levels: VivChannelLevels | null = null;
let renders = 0;

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function host(): HTMLElement {
  const element = document.getElementById("viewer");
  if (element === null) throw new Error("The harness page has no #viewer element");
  return element;
}

function layerFor(current: VivChannelLevels, display: readonly ChannelDisplay[]): Layer {
  const props = vivChannelLayerProps(current, display);
  return new MultiscaleImageLayer<[]>({
    id: "channels",
    loader: [...current.levels],
    selections: props.selections.map((selection) => ({ ...selection })),
    contrastLimits: props.contrastLimits.map((limits) => [...limits] as [number, number]),
    colors: props.colors.map((color) => [...color] as [number, number, number]),
    channelsVisible: [...props.channelsVisible],
    dtype: props.dtype,
    pickable: false,
  } as never) as Layer;
}

async function open(url: string, formatId: SlideFormatId): Promise<ChannelsOpened> {
  deck?.finalize();
  source?.close();
  host().replaceChildren();
  errors.length = 0;
  source = await registry.open({ formatId, url });
  levels = createVivChannelLevels(source, {
    onTileError: (error) => {
      errors.push(error.message);
    },
  });
  const [base] = source.levels;
  if (base === undefined) throw new Error("The slide has no levels");
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "display:block;width:100%;height:100%";
  host().append(canvas);
  deck = new Deck<OrthographicView>({
    canvas,
    views: view,
    controller: false,
    viewState: { target: [base.width / 2, base.height / 2, 0], zoom: 0 },
    layers: [],
    useDevicePixels: false,
    deviceProps: { type: "webgl", webgl: { antialias: false } },
    onError: (error) => {
      errors.push(error.message);
    },
    onAfterRender: () => {
      renders++;
    },
  });
  return {
    dtype: levels.dtype,
    channels: levels.channels.map((channel) => channel.name),
    ladder: levels.ladder.map((level) => level.downsample),
    slide: { width: base.width, height: base.height },
  };
}

async function show(display: readonly ChannelDisplay[]): Promise<ChannelsShown> {
  if (deck === null || levels === null || source === null) throw new Error("No slide is open");
  const [base] = source.levels;
  const canvas = deck.getCanvas();
  if (base === undefined || canvas === null) throw new Error("The slide has no levels");
  const scale = Math.min(canvas.clientWidth / base.width, canvas.clientHeight / base.height);
  deck.setProps({
    viewState: { target: [base.width / 2, base.height / 2, 0], zoom: Math.log2(scale) },
    layers: [layerFor(levels, display)],
  });
  const startedAt = performance.now();
  const renderedBefore = renders;
  let lastRender = renders;
  let quiet = 0;
  while (performance.now() - startedAt < 15_000) {
    await nextFrame();
    if (renders !== lastRender) {
      lastRender = renders;
      quiet = 0;
    } else if (renders > renderedBefore && levels.pending() === 0) {
      quiet++;
    }
    if (quiet >= 10) break;
  }
  return {
    errors: [...errors],
    canvas: { width: canvas.clientWidth, height: canvas.clientHeight },
    scale,
  };
}

window.channelsHarness = { open, show };
