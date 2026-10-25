import type { OverlayKind, SlideFormatId } from "@parfocal/viewer-engine";

export interface OverlayRenderRequest {
  readonly url: string;
  readonly formatId: SlideFormatId;
  readonly layers: readonly OverlayKind[];
  readonly registration: "before-mount" | "after-open";
  readonly reverse: boolean;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly centre: { readonly x: number; readonly y: number };
  readonly magnification: number;
  readonly micronsPerPixel: number;
}

export type OverlayChange =
  | { readonly kind: "visible"; readonly id: string; readonly visible: boolean }
  | { readonly kind: "opacity"; readonly id: string; readonly opacity: number }
  | { readonly kind: "remove"; readonly id: string }
  | { readonly kind: "invalidate"; readonly id: string };

export interface OverlayRenderResult {
  readonly errors: readonly string[];
  readonly layerIds: readonly string[];
}

export interface ResourceWatch {
  readonly watched: number;
  readonly destroyed: number;
}

export interface OverlayHarness {
  render(request: OverlayRenderRequest): Promise<OverlayRenderResult>;
  watch(id: string): ResourceWatch;
  watched(): ResourceWatch;
  change(change: OverlayChange): Promise<OverlayRenderResult>;
  reset(): void;
}

export const overlayHarnessGlobal = "parfocalOverlayHarness";
