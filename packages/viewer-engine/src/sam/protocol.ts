import type {
  SamEncoded,
  SamOutputs,
  SamPrompt,
  SamPromptOutcome,
  SamReady,
} from "./inference-engine.ts";
import type { SamGraph } from "./variants.ts";

export type SamRequest =
  | { readonly type: "init"; readonly modelsUrl: string }
  | {
      readonly type: "encode";
      readonly requestId: number;
      readonly id: string;
      readonly pixels: Float32Array<ArrayBuffer>;
    }
  | {
      readonly type: "prompt";
      readonly requestId: number;
      readonly id: string;
      readonly prompt: SamPrompt;
    }
  | { readonly type: "segmentAll"; readonly requestId: number; readonly id: string }
  | { readonly type: "drop"; readonly id: string };

export type SamReply =
  | { readonly type: "stage"; readonly graph: SamGraph }
  | { readonly type: "ready"; readonly ready: SamReady }
  | { readonly type: "encoded"; readonly requestId: number; readonly encoded: SamEncoded }
  | { readonly type: "prompted"; readonly requestId: number; readonly outcome: SamPromptOutcome }
  | { readonly type: "segmented"; readonly requestId: number; readonly outputs: SamOutputs }
  | { readonly type: "failed"; readonly requestId: number | null; readonly message: string };
