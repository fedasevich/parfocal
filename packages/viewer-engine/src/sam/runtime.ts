import type { SamProvider } from "./variants.ts";

export interface SamTensor {
  readonly dims: readonly number[];
  readonly data: Float32Array;
  dispose(): void;
}

export interface SamSession {
  readonly inputNames: readonly string[];
  readonly outputNames: readonly string[];
  run(feeds: Readonly<Record<string, SamTensor>>): Promise<Record<string, SamTensor>>;
  release(): Promise<void>;
}

export interface SamRuntime {
  createSession(bytes: Uint8Array, provider: SamProvider): Promise<SamSession>;
  tensor(data: Float32Array, dims: readonly number[]): SamTensor;
}
