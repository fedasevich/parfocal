import { type BytePort, serveBytes } from "../decode/byte-relay.ts";
import { onWorkerFailure, type WorkerHandle, type WorkerOpenRequest } from "../decode/protocol.ts";
import { createRangeCache, type RangeCache } from "../decode/range-cache.ts";
import {
  type PatchCacheStats,
  type PatchQuery,
  type PatchRead,
  type PatchReader,
  PatchReaderClosedError,
  type PatchSourceInfo,
} from "./patch-reader.ts";
import type { PatchReply, PatchRequest } from "./protocol.ts";

export type PatchWorker = WorkerHandle<PatchRequest, PatchReply>;

export interface PatchBytePorts {
  readonly local: BytePort;
  readonly remote: MessagePort;
}

export interface WorkerPatchReaderOptions {
  readonly request: WorkerOpenRequest;
  readonly cacheSize?: number;
  readonly spawn?: () => PatchWorker;
  readonly channel?: () => PatchBytePorts;
  readonly cache?: RangeCache;
}

export class PatchWorkerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PatchWorkerError";
  }
}

export function spawnPatchWorker(): PatchWorker {
  return new Worker(new URL("../workers/patch.worker.ts", import.meta.url), {
    type: "module",
    name: "parfocal-patch",
  });
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError");
}

function messageChannel(): PatchBytePorts {
  const { port1, port2 } = new MessageChannel();
  return { local: port1, remote: port2 };
}

interface Waiting {
  readonly resolve: (read: PatchRead) => void;
  readonly reject: (error: Error) => void;
}

export function createWorkerPatchReader(options: WorkerPatchReaderOptions): PatchReader {
  const worker = (options.spawn ?? spawnPatchWorker)();
  const bytes = (options.channel ?? messageChannel)();
  const cache = options.cache ?? createRangeCache();
  const waiting = new Map<number, Waiting>();
  let nextId = 0;
  let closed = false;
  let failure: PatchWorkerError | null = null;
  let hits = 0;
  let misses = 0;
  let size = 0;

  serveBytes(bytes.local, cache);

  const ready = new Promise<PatchSourceInfo>((resolve, reject) => {
    onWorkerFailure(worker, "patch", (reason) => {
      if (failure !== null) return;
      failure = new PatchWorkerError(reason);
      reject(failure);
      for (const waiter of waiting.values()) waiter.reject(failure);
      waiting.clear();
    });
    worker.addEventListener("message", (event) => {
      const reply = event.data;
      if (reply.type === "opened") {
        resolve(reply.info);
        return;
      }
      if (reply.type === "failed" && reply.id === null) {
        reject(new PatchWorkerError(reply.message));
        return;
      }
      const waiter = waiting.get(reply.id as number);
      if (waiter === undefined) return;
      waiting.delete(reply.id as number);
      if (reply.type === "patch") {
        if (reply.cacheHit) hits += 1;
        else misses += 1;
        size = Math.min(size + (reply.cacheHit ? 0 : 1), options.cacheSize ?? 8);
        waiter.resolve({ patch: reply.patch, cacheHit: reply.cacheHit, moved: reply.moved });
      } else {
        waiter.reject(new PatchWorkerError(reply.message));
      }
    });
  });
  ready.catch(() => undefined);
  worker.postMessage(
    {
      type: "open",
      request: options.request,
      bytes: bytes.remote,
      ...(options.cacheSize === undefined ? {} : { cacheSize: options.cacheSize }),
    },
    [bytes.remote],
  );

  return {
    ready,
    read(query: PatchQuery, signal?: AbortSignal): Promise<PatchRead> {
      if (closed) return Promise.reject(new PatchReaderClosedError());
      return ready.then(
        () =>
          new Promise<PatchRead>((resolve, reject) => {
            if (failure !== null) {
              reject(failure);
              return;
            }
            if (signal?.aborted === true) {
              reject(abortError(signal));
              return;
            }
            const id = nextId++;
            waiting.set(id, { resolve, reject });
            signal?.addEventListener(
              "abort",
              () => {
                if (waiting.delete(id)) {
                  reject(abortError(signal));
                }
              },
              { once: true },
            );
            worker.postMessage({ type: "read", id, query }, []);
          }),
      );
    },
    stats(): PatchCacheStats {
      return { hits, misses, reads: misses, size };
    },
    close() {
      closed = true;
      worker.terminate();
      bytes.local.close?.();
      const error = new PatchReaderClosedError();
      for (const waiter of waiting.values()) waiter.reject(error);
      waiting.clear();
    },
  };
}
