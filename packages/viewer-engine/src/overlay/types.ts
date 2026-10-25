import type { SlideArea } from "../camera/camera.ts";
import type { OverlayLayer } from "../engine/types.ts";
import type { OverlayKind } from "./z-order.ts";

export type Rgba = readonly [red: number, green: number, blue: number, alpha: number];

export interface PolygonBatch {
  readonly count: number;
  readonly positions: Float32Array;
  readonly starts: Uint32Array;
  readonly colors: Uint8Array;
  readonly indices: Uint32Array;
}

export interface PathBatch {
  readonly count: number;
  readonly positions: Float32Array;
  readonly starts: Uint32Array;
  readonly colors: Uint8Array;
}

export interface PointBatch {
  readonly count: number;
  readonly positions: Float32Array;
  readonly colors: Uint8Array;
}

export interface ShapeData {
  readonly polygons?: PolygonBatch;
  readonly paths?: PathBatch;
  readonly points?: PointBatch;
}

export interface VectorStyle {
  readonly fillOpacity: number;
  readonly lineWidthPx: number;
  readonly pointRadiusPx: number;
}

export interface RasterData {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array<ArrayBuffer> | Uint8ClampedArray<ArrayBuffer>;
  readonly area: SlideArea;
  readonly smooth: boolean;
}

export interface PinBatch {
  readonly count: number;
  readonly positions: Float32Array;
  readonly resolved: Uint8Array;
}

export type VectorKind = Extract<
  OverlayKind,
  "human-annotations" | "ai-proposals" | "nuclei" | "measurements"
>;

export type RasterKind = Extract<OverlayKind, "heatmap" | "coverage">;

export type PinKind = Extract<OverlayKind, "comment-pins">;

export interface OverlayState {
  readonly visible: boolean;
  readonly opacity: number;
}

interface OverlayBase extends OverlayLayer, OverlayState {
  readonly kind: OverlayKind;
}

export interface VectorOverlay extends OverlayBase {
  readonly kind: VectorKind;
  readonly shapes: ShapeData;
  readonly style: VectorStyle;
}

export interface RasterOverlay extends OverlayBase {
  readonly kind: RasterKind;
  readonly raster: RasterData;
}

export interface PinOverlay extends OverlayBase {
  readonly kind: PinKind;
  readonly pins: PinBatch;
}

export type OverlayDescription = VectorOverlay | RasterOverlay | PinOverlay;
