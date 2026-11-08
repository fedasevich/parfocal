import { type AisInstance, aisInstances } from "./ais-instances.ts";

export interface AisRequest {
  readonly id: number;
  readonly maps: Float32Array;
  readonly width: number;
  readonly height: number;
}

export type AisReply =
  | { readonly id: number; readonly instances: AisInstance[] }
  | { readonly id: number; readonly error: string };

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<AisRequest>) => void) | null;
  postMessage(message: AisReply): void;
};

scope.onmessage = (event) => {
  const { id, maps, width, height } = event.data;
  try {
    scope.postMessage({ id, instances: aisInstances(maps, width, height) });
  } catch (error) {
    scope.postMessage({ id, error: error instanceof Error ? error.message : "Outlining failed" });
  }
};
