import type { OutlineMode } from "@parfocal/viewer-engine";
import type { InterpolationRule } from "@parfocal/viewer-engine/viv";

export interface SyntheticRequest {
  readonly camera: { readonly x: number; readonly y: number; readonly zoom: number };
  readonly interpolation: InterpolationRule;
  readonly brightness?: number;
  readonly brightnessBy?: "engine" | "css-filter";
  readonly annotations?: boolean;
  readonly outlineMode?: OutlineMode;
  readonly tiles?: {
    readonly hold?: "finest" | "all";
    readonly delayFinestMs?: number;
    readonly settle?: boolean;
  };
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
  moveTo(camera: SyntheticRequest["camera"]): Promise<void>;
  loadState(): { pending: number; waitingMs: number; answerMs: number | null };
  reset(): void;
}

export const syntheticHarnessGlobal = "parfocalSyntheticHarness";
