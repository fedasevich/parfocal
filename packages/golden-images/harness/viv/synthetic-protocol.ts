import type { InterpolationRule } from "@parfocal/viewer-engine/viv";

export interface SyntheticRequest {
  readonly camera: { readonly x: number; readonly y: number; readonly zoom: number };
  readonly interpolation: InterpolationRule;
}

export interface TextureFilter {
  readonly tileZoom: number | null;
  readonly minFilter: string | null;
  readonly magFilter: string | null;
}

export interface SyntheticResult {
  readonly camera: { readonly x: number; readonly y: number; readonly zoom: number };
  readonly errors: readonly string[];
  readonly textures: readonly TextureFilter[];
}

export interface SyntheticHarness {
  render(request: SyntheticRequest): Promise<SyntheticResult>;
  reset(): void;
}

export const syntheticHarnessGlobal = "parfocalSyntheticHarness";
