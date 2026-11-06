import type { WorkerOpenRequest } from "../decode/protocol.ts";
import type { Patch, PatchQuery, PatchSourceInfo } from "./patch-reader.ts";

export type PatchRequest =
  | {
      readonly type: "open";
      readonly request: WorkerOpenRequest;
      readonly bytes: MessagePort;
      readonly cacheSize?: number;
    }
  | { readonly type: "read"; readonly id: number; readonly query: PatchQuery };

export type PatchReply =
  | { readonly type: "opened"; readonly info: PatchSourceInfo }
  | {
      readonly type: "patch";
      readonly id: number;
      readonly patch: Patch;
      readonly cacheHit: boolean;
      readonly moved: boolean;
    }
  | { readonly type: "failed"; readonly id: number | null; readonly message: string };
