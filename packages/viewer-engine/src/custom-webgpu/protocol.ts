import type { Rgba } from "../overlay/batch-types.ts";

export interface FrameView {
  readonly x: number;
  readonly y: number;
  readonly scale: number;
  readonly width: number;
  readonly height: number;
}

export interface SetCasing {
  readonly widthPx: number;
  readonly color: Rgba;
  readonly followsAlpha: boolean;
}

export interface SetDraw {
  readonly kind: "set";
  readonly id: string;
  readonly fillAlpha: number;
  readonly alpha: number;
  readonly lineWidthPx: number;
  readonly lineColor: Rgba | null;
  readonly casing: SetCasing | null;
  readonly dash: readonly [on: number, off: number] | null;
  readonly pointRadiusPx: number;
}

export interface RasterDraw {
  readonly kind: "raster";
  readonly id: string;
  readonly alpha: number;
  readonly area: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
}

export interface PinDraw {
  readonly kind: "pins";
  readonly id: string;
  readonly alpha: number;
  readonly sizePx: number;
}

export interface PinFrames {
  readonly width: number;
  readonly height: number;
  readonly anchorX: number;
  readonly anchorY: number;
  readonly openX: number;
  readonly resolvedX: number;
  readonly y: number;
}

export type LayerDraw = SetDraw | RasterDraw | PinDraw;

export interface FrameState {
  readonly tiles: ArrayBuffer;
  readonly tileCount: number;
  readonly nearest: boolean;
  readonly tint: number;
  readonly view: FrameView;
  readonly layers: readonly LayerDraw[];
}

export interface SetCounts {
  readonly triangles: number;
  readonly segments: number;
  readonly points: number;
}

export type RenderRequest =
  | { readonly type: "init"; readonly canvas: OffscreenCanvas }
  | { readonly type: "resize"; readonly width: number; readonly height: number }
  | { readonly type: "atlas"; readonly tileSize: number; readonly layers: number }
  | {
      readonly type: "tile";
      readonly layer: number;
      readonly width: number;
      readonly height: number;
      readonly rgba: ArrayBuffer;
    }
  | {
      readonly type: "set";
      readonly id: string;
      readonly data: ArrayBuffer;
      readonly counts: SetCounts;
    }
  | {
      readonly type: "raster";
      readonly id: string;
      readonly width: number;
      readonly height: number;
      readonly rgba: ArrayBuffer;
      readonly smooth: boolean;
    }
  | {
      readonly type: "pinAtlas";
      readonly width: number;
      readonly height: number;
      readonly rgba: ArrayBuffer;
      readonly frames: PinFrames;
    }
  | { readonly type: "drop"; readonly id: string }
  | { readonly type: "frame"; readonly id: number; readonly frame: FrameState }
  | { readonly type: "destroy" };

export type RenderErrorSource = "start" | "uncaptured" | "device-lost";

export type RenderResponse =
  | { readonly type: "ready"; readonly maxLayers: number }
  | { readonly type: "drawn"; readonly id: number }
  | { readonly type: "error"; readonly source: RenderErrorSource; readonly message: string };

export const renderWorkerName = "parfocal-render";

export const tileInstanceFloats = 8;

export const triangleInstanceBytes = 28;

export const segmentInstanceBytes = 24;

export const pointInstanceBytes = 12;
