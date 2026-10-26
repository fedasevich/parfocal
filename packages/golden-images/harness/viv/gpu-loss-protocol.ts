import type { SlideFormatId } from "@parfocal/viewer-engine";

export interface GpuLossRequest {
  readonly url: string;
  readonly formatId: SlideFormatId;
  readonly magnification: number;
  readonly micronsPerPixel: number;
  readonly centre: { readonly x: number; readonly y: number };
  readonly withOverlay: boolean;
  readonly restoreTimeoutMs?: number;
  readonly sleepWhenIdle?: boolean;
}

export interface GpuLossState {
  readonly camera: { readonly x: number; readonly y: number; readonly zoom: number };
  readonly slideId: string | null;
  readonly status: "ready" | "lost" | "failed";
  readonly losses: number;
  readonly recoveries: number;
  readonly failure: { readonly reason: string; readonly userMessage: string } | null;
  readonly errorNames: readonly string[];
  readonly errorMessages: readonly string[];
  readonly canvases: number;
  readonly asleep: boolean;
  readonly settled: boolean;
  readonly overlayLayerIds: readonly string[];
  readonly parfocalListeners: number;
}

export interface GpuLossHarness {
  readonly prototypes: { readonly deck: object };
  open(request: GpuLossRequest): Promise<void>;
  settle(timeoutMs: number): Promise<void>;
  state(): GpuLossState;
  loseContext(): Promise<void>;
  restoreContext(): void;
  moveTo(camera: { x: number; y: number; zoom: number }): void;
  useRoute(): Promise<boolean>;
  listeners(): number;
  dispose(): void;
}

export const gpuLossHarnessGlobal = "parfocalGpuLossHarness";
