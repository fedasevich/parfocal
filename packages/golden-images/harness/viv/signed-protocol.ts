export interface SignedOpenResult {
  readonly camera: { readonly x: number; readonly y: number; readonly zoom: number };
  readonly slide: {
    readonly width: number;
    readonly height: number;
    readonly micronsPerPixel: number | null;
  };
  readonly errors: readonly string[];
}

export interface SignedHarness {
  open(slideId: string): Promise<SignedOpenResult>;
  settle(): Promise<void>;
  camera(): { readonly x: number; readonly y: number; readonly zoom: number };
  dispose(): void;
}

export const signedHarnessGlobal = "parfocalSignedHarness";
