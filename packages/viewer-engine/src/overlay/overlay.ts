import type { OverlayLayer } from "../engine/types.ts";
import type {
  OverlayDescription,
  OverlayState,
  PinBatch,
  PinOverlay,
  RasterData,
  RasterKind,
  RasterOverlay,
  ShapeData,
  VectorKind,
  VectorOverlay,
  VectorStyle,
} from "./types.ts";
import { isOverlayKind, overlayOrder } from "./z-order.ts";

export const defaultOverlayState: OverlayState = { visible: true, opacity: 1 };

export const defaultVectorStyles: Readonly<Record<VectorKind, VectorStyle>> = {
  "human-annotations": { fillOpacity: 0.18, lineWidthPx: 2, pointRadiusPx: 5 },
  "ai-proposals": { fillOpacity: 0.12, lineWidthPx: 2, pointRadiusPx: 5 },
  nuclei: { fillOpacity: 0.3, lineWidthPx: 1, pointRadiusPx: 2 },
  measurements: { fillOpacity: 0, lineWidthPx: 2, pointRadiusPx: 4 },
};

export const defaultRasterSmoothing: Readonly<Record<RasterKind, boolean>> = {
  heatmap: true,
  coverage: false,
};

export interface OverlayOptions extends Partial<OverlayState> {
  readonly id: string;
}

export interface VectorOverlayOptions extends OverlayOptions {
  readonly kind: VectorKind;
  readonly shapes: ShapeData;
  readonly style?: Partial<VectorStyle>;
}

export interface RasterOverlayOptions extends OverlayOptions {
  readonly kind: RasterKind;
  readonly raster: Omit<RasterData, "smooth"> & { readonly smooth?: boolean };
}

export interface PinOverlayOptions extends OverlayOptions {
  readonly pins: PinBatch;
}

function checkedOpacity(opacity: number): number {
  if (Number.isNaN(opacity)) throw new RangeError("Overlay opacity must be a number");
  return Math.min(1, Math.max(0, opacity));
}

function stateOf(options: Partial<OverlayState>): OverlayState {
  return {
    visible: options.visible ?? defaultOverlayState.visible,
    opacity: checkedOpacity(options.opacity ?? defaultOverlayState.opacity),
  };
}

export function createVectorOverlay(options: VectorOverlayOptions): VectorOverlay {
  return {
    id: options.id,
    kind: options.kind,
    order: overlayOrder(options.kind),
    ...stateOf(options),
    shapes: options.shapes,
    style: { ...defaultVectorStyles[options.kind], ...options.style },
  };
}

export function createRasterOverlay(options: RasterOverlayOptions): RasterOverlay {
  const { width, height, rgba } = options.raster;
  if (rgba.length !== width * height * 4) {
    throw new RangeError("A raster needs one RGBA value for each pixel");
  }
  return {
    id: options.id,
    kind: options.kind,
    order: overlayOrder(options.kind),
    ...stateOf(options),
    raster: {
      ...options.raster,
      smooth: options.raster.smooth ?? defaultRasterSmoothing[options.kind],
    },
  };
}

export function createPinOverlay(options: PinOverlayOptions): PinOverlay {
  const { count, positions, resolved } = options.pins;
  if (positions.length !== count * 2 || resolved.length !== count) {
    throw new RangeError("A pin batch needs a position and a state for each pin");
  }
  return {
    id: options.id,
    kind: "comment-pins",
    order: overlayOrder("comment-pins"),
    ...stateOf(options),
    pins: options.pins,
  };
}

export function withOverlayState<Description extends OverlayDescription>(
  overlay: Description,
  change: Partial<OverlayState>,
): Description {
  return { ...overlay, ...stateOf({ ...overlay, ...change }) };
}

export function isOverlayDescription(layer: OverlayLayer): layer is OverlayDescription {
  return "kind" in layer && isOverlayKind(layer.kind);
}

export function isRasterOverlay(overlay: OverlayDescription): overlay is RasterOverlay {
  return overlay.kind === "heatmap" || overlay.kind === "coverage";
}

export function isPinOverlay(overlay: OverlayDescription): overlay is PinOverlay {
  return overlay.kind === "comment-pins";
}
