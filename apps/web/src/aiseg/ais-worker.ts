import { type SamFrame, samPixels } from "@parfocal/viewer-engine/sam-prompt";
import { type AisInstance, aisInstances } from "./ais-instances.ts";

export type AisRequest =
  | {
      readonly id: number;
      readonly kind: "outline";
      readonly maps: Float32Array;
      readonly width: number;
      readonly height: number;
    }
  | {
      readonly id: number;
      readonly kind: "pixels";
      readonly rgb: Uint8Array;
      readonly frame: SamFrame;
    };

export type AisReply =
  | { readonly id: number; readonly instances: AisInstance[] }
  | { readonly id: number; readonly pixels: Float32Array }
  | { readonly id: number; readonly error: string };

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<AisRequest>) => void) | null;
  postMessage(message: AisReply, transfer?: Transferable[]): void;
};

scope.onmessage = (event) => {
  const request = event.data;
  try {
    if (request.kind === "pixels") {
      const pixels = samPixels(request.rgb, request.frame);
      scope.postMessage({ id: request.id, pixels }, [pixels.buffer]);
      return;
    }
    const instances = aisInstances(request.maps, request.width, request.height);
    scope.postMessage({ id: request.id, instances });
  } catch (error) {
    scope.postMessage({
      id: request.id,
      error: error instanceof Error ? error.message : "Outlining failed",
    });
  }
};
