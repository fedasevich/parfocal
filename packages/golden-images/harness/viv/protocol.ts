import type { DecodeReport, SlideArea, SlideFormatId } from "@parfocal/viewer-engine";

export type VivView =
  | { readonly kind: "fit" }
  | {
      readonly kind: "magnification";
      readonly magnification: number;
      readonly x: number;
      readonly y: number;
    }
  | { readonly kind: "camera"; readonly x: number; readonly y: number; readonly zoom: number };

export type VivBreakage =
  | "none"
  | "swap-red-blue"
  | "wrong-level"
  | "ycbcr-as-rgb"
  | "native-unvalidated";

export interface VivSceneRequest {
  readonly url: string;
  readonly formatId: SlideFormatId;
  readonly view: VivView;
  readonly breakage: VivBreakage;
  readonly tissue?: SlideArea;
}

export interface VivSceneResult {
  readonly camera: { readonly x: number; readonly y: number; readonly zoom: number };
  readonly slide: {
    readonly width: number;
    readonly height: number;
    readonly micronsPerPixel: number | null;
  };
  readonly ladder: readonly { readonly downsample: number; readonly backing: number }[];
  readonly errors: readonly string[];
  readonly decoded: { readonly workers: number; readonly dispatched: number } | null;
  readonly jpeg: readonly (DecodeReport | null)[];
}

export interface VivHarness {
  render(request: VivSceneRequest): Promise<VivSceneResult>;
  reset(): void;
}

export const harnessGlobal = "parfocalVivHarness";
