import type { DecodeReport, SlideFormatId, SlideIndex } from "../pixel-source/types.ts";
import type { VivRegion } from "../viv/viv-levels.ts";

export interface WorkerOpenRequest {
  readonly formatId: SlideFormatId;
  readonly url: string;
  readonly index?: SlideIndex;
  readonly nativeJpeg?: "off" | "unvalidated";
  readonly levels?: number;
}

export type DecodeRequest =
  | { readonly type: "open"; readonly request: WorkerOpenRequest; readonly bytes: MessagePort }
  | { readonly type: "read"; readonly id: number; readonly region: VivRegion };

export type DecodeReply =
  | { readonly type: "opened"; readonly report: DecodeReport | null }
  | {
      readonly type: "tile";
      readonly id: number;
      readonly data: Uint8Array<ArrayBuffer> | Uint16Array<ArrayBuffer>;
      readonly width: number;
      readonly height: number;
    }
  | { readonly type: "failed"; readonly id: number | null; readonly message: string };

export interface ByteRequest {
  readonly id: number;
  readonly url: string;
  readonly range: string | null;
}

export type ByteReply =
  | {
      readonly id: number;
      readonly status: number;
      readonly bytes: Uint8Array<ArrayBuffer>;
      readonly contentRange: string | null;
    }
  | { readonly id: number; readonly error: string };

export interface MessageTarget<Outgoing, Incoming> {
  postMessage(message: Outgoing, transfer: Transferable[]): void;
  addEventListener(type: "message", listener: (event: MessageEvent<Incoming>) => void): void;
}

export interface WorkerHandle<Outgoing, Incoming> {
  postMessage(message: Outgoing, transfer: Transferable[]): void;
  addEventListener(type: "message", listener: (event: MessageEvent<Incoming>) => void): void;
  addEventListener(type: "error" | "messageerror", listener: (event: Event) => void): void;
  terminate(): void;
}

export interface WorkerFailureEvents {
  addEventListener(type: "error" | "messageerror", listener: (event: Event) => void): void;
}

export function onWorkerFailure(
  worker: WorkerFailureEvents,
  name: string,
  listener: (reason: string) => void,
): void {
  worker.addEventListener("error", (event) => {
    const detail = "message" in event && typeof event.message === "string" ? event.message : "";
    listener(
      detail === ""
        ? `The ${name} worker failed to start or stopped`
        : `The ${name} worker stopped: ${detail}`,
    );
  });
  worker.addEventListener("messageerror", () => {
    listener(`A message from the ${name} worker could not be read`);
  });
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
