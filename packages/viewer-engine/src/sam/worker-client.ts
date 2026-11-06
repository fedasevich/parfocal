import type { MessageTarget } from "../decode/protocol.ts";
import type {
  SamEncoded,
  SamOutputs,
  SamPrompt,
  SamPromptOutcome,
  SamReady,
} from "./inference-engine.ts";
import type { SamReply, SamRequest } from "./protocol.ts";
import type { SamGraph } from "./variants.ts";

export interface SamWorker extends MessageTarget<SamRequest, SamReply> {
  terminate(): void;
}

export interface SamClientOptions {
  readonly modelsUrl: string;
  readonly spawn?: () => SamWorker;
  readonly onStage?: (graph: SamGraph) => void;
}

export interface SamClient {
  readonly ready: Promise<SamReady>;
  encode(id: string, pixels: Float32Array<ArrayBuffer>): Promise<SamEncoded>;
  prompt(id: string, prompt: SamPrompt): Promise<SamPromptOutcome>;
  segmentAll(id: string): Promise<SamOutputs>;
  drop(id: string): void;
  close(): void;
}

export class SamWorkerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SamWorkerError";
  }
}

export class SamClientClosedError extends Error {
  constructor() {
    super("The inference client was closed");
    this.name = "SamClientClosedError";
  }
}

export function spawnSamWorker(): SamWorker {
  return new Worker(new URL("../workers/sam.worker.ts", import.meta.url), {
    type: "module",
    name: "parfocal-sam",
  });
}

interface Waiting {
  readonly resolve: (reply: SamReply) => void;
  readonly reject: (error: Error) => void;
}

export function createSamClient(options: SamClientOptions): SamClient {
  const worker = (options.spawn ?? spawnSamWorker)();
  const waiting = new Map<number, Waiting>();
  let nextRequestId = 0;
  let closed = false;

  const ready = new Promise<SamReady>((resolve, reject) => {
    worker.addEventListener("message", (event) => {
      const reply = event.data;
      if (reply.type === "stage") {
        options.onStage?.(reply.graph);
        return;
      }
      if (reply.type === "ready") {
        resolve(reply.ready);
        return;
      }
      if (reply.type === "failed" && reply.requestId === null) {
        reject(new SamWorkerError(reply.message));
        return;
      }
      const requestId = reply.requestId;
      if (requestId === null) {
        return;
      }
      const waiter = waiting.get(requestId);
      if (waiter === undefined) {
        return;
      }
      waiting.delete(requestId);
      if (reply.type === "failed") {
        waiter.reject(new SamWorkerError(reply.message));
      } else {
        waiter.resolve(reply);
      }
    });
  });
  ready.catch(() => undefined);
  worker.postMessage({ type: "init", modelsUrl: options.modelsUrl }, []);

  function request(
    build: (requestId: number) => SamRequest,
    transfer: Transferable[] = [],
  ): Promise<SamReply> {
    if (closed) {
      return Promise.reject(new SamClientClosedError());
    }
    return new Promise<SamReply>((resolve, reject) => {
      const requestId = nextRequestId++;
      waiting.set(requestId, { resolve, reject });
      worker.postMessage(build(requestId), transfer);
    });
  }

  function unexpected(reply: SamReply): never {
    throw new SamWorkerError(`Unexpected reply ${reply.type}`);
  }

  return {
    ready,
    async encode(id, pixels) {
      const reply = await request(
        (requestId) => ({ type: "encode", requestId, id, pixels }),
        [pixels.buffer],
      );
      return reply.type === "encoded" ? reply.encoded : unexpected(reply);
    },
    async prompt(id, prompt) {
      const reply = await request((requestId) => ({ type: "prompt", requestId, id, prompt }));
      return reply.type === "prompted" ? reply.outcome : unexpected(reply);
    },
    async segmentAll(id) {
      const reply = await request((requestId) => ({ type: "segmentAll", requestId, id }));
      return reply.type === "segmented" ? reply.outputs : unexpected(reply);
    },
    drop(id) {
      if (!closed) {
        worker.postMessage({ type: "drop", id }, []);
      }
    },
    close() {
      if (closed) {
        return;
      }
      closed = true;
      worker.terminate();
      const error = new SamClientClosedError();
      for (const waiter of waiting.values()) {
        waiter.reject(error);
      }
      waiting.clear();
    },
  };
}
