import type { SlideArea } from "../camera/camera.ts";
import type { OverlayLayer } from "../engine/types.ts";
import type { OverlayKind } from "./z-order.ts";

export type Rgba = readonly [red: number, green: number, blue: number, alpha: number];

export interface PolygonBatch {
  readonly count: number;
  readonly positions: Float32Array;
  readonly starts: Uint32Array;
  readonly colors: Uint8Array;
  readonly holeStarts: Uint32Array;
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

export interface LineCasing {
  readonly widthPx: number;
  readonly color: Rgba;
  readonly followsAlpha?: boolean;
}

export interface VectorStyle {
  readonly fillOpacity: number;
  readonly lineWidthPx: number;
  readonly pointRadiusPx: number;
  readonly casing: LineCasing | null;
  readonly lineColor: Rgba | null;
  readonly dash: readonly [on: number, off: number] | null;
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

export interface LabelBatch {
  readonly count: number;
  readonly positions: Float32Array;
  readonly offsets: Float32Array;
  readonly sizes: Float32Array;
  readonly colors: Uint8Array;
  readonly texts: readonly string[];
}

export type VectorKind = Extract<
  OverlayKind,
  "human-annotations" | "ai-proposals" | "nuclei" | "measurements"
>;

export type RasterKind = Extract<OverlayKind, "heatmap" | "coverage">;

export type PinKind = Extract<OverlayKind, "comment-pins">;

export type LabelKind = Extract<OverlayKind, "id-labels">;

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

export type HeatmapColormap = "viridis" | "inferno" | "turbo";

export interface HeatmapSource {
  readonly model: string;
  readonly version: string | null;
}

export interface HeatmapGrid {
  readonly width: number;
  readonly height: number;
  readonly values: Float32Array | Uint8Array;
  readonly area: SlideArea;
}

export interface HeatmapLook {
  readonly colormap: HeatmapColormap;
  readonly threshold: number;
}

export interface HeatmapData {
  readonly grid: HeatmapGrid;
  readonly look: HeatmapLook;
  readonly source: HeatmapSource;
}

export interface RasterOverlay extends OverlayBase {
  readonly kind: RasterKind;
  readonly raster: RasterData;
  readonly heatmap?: HeatmapData;
}

export interface PinOverlay extends OverlayBase {
  readonly kind: PinKind;
  readonly pins: PinBatch;
}

export interface LabelOverlay extends OverlayBase {
  readonly kind: LabelKind;
  readonly labels: LabelBatch;
}

export type OverlayDescription = VectorOverlay | RasterOverlay | PinOverlay | LabelOverlay;
