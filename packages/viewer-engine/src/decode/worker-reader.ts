import type { DecodeReport } from "../pixel-source/types.ts";
import type { VivRegion, VivRegionReader, VivTile } from "../viv/viv-levels.ts";
import { regionKey } from "../viv/viv-levels.ts";
import { type BytePort, serveBytes } from "./byte-relay.ts";
import {
  createDecodePool,
  type DecodePoolStats,
  defaultRetainedResults,
  type PoolPoint,
} from "./decode-pool.ts";
import type { DecodeReply, DecodeRequest, MessageTarget, WorkerOpenRequest } from "./protocol.ts";
import { createRangeCache, type RangeCache, type RangeCacheStats } from "./range-cache.ts";

export interface DecodeWorker extends MessageTarget<DecodeRequest, DecodeReply> {
  terminate(): void;
}

export interface BytePorts {
  readonly local: BytePort;
  readonly remote: MessagePort;
}

export interface WorkerReaderOptions {
  readonly request: WorkerOpenRequest;
  readonly size?: number;
  readonly retain?: number;
  readonly spawn?: (index: number) => DecodeWorker;
  readonly channel?: () => BytePorts;
  readonly cache?: RangeCache;
}

export interface DecodeStats extends DecodePoolStats {
  readonly network: RangeCacheStats;
}

export interface WorkerRegionReader {
  readonly read: VivRegionReader;
  readonly ready: Promise<void>;
  jpegReports(): readonly (DecodeReport | null)[];
  setFocus(point: PoolPoint | null): void;
  stats(): DecodeStats;
  idle(): boolean;
  dispose(): void;
}

export class DecodeWorkerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecodeWorkerError";
  }
}

export function spawnDecodeWorker(index: number): DecodeWorker {
  return new Worker(new URL("../workers/decode.worker.ts", import.meta.url), {
    type: "module",
    name: `parfocal-decode-${index}`,
  });
}

function messageChannel(): BytePorts {
  const { port1, port2 } = new MessageChannel();
  return { local: port1, remote: port2 };
}

interface Waiting {
  readonly resolve: (tile: VivTile) => void;
  readonly reject: (error: Error) => void;
}

export function createWorkerRegionReader(options: WorkerReaderOptions): WorkerRegionReader {
  const spawn = options.spawn ?? spawnDecodeWorker;
  const channel = options.channel ?? messageChannel;
  const cache = options.cache ?? createRangeCache();
  const waiting = new Map<number, Waiting>();
  const workers: DecodeWorker[] = [];
  const ports: BytePort[] = [];
  let nextId = 0;

  const pool = createDecodePool<VivRegion, VivTile>({
    ...(options.size === undefined ? {} : { size: options.size }),
    retain: options.retain ?? defaultRetainedResults,
    run: (slot, region) =>
      new Promise<VivTile>((resolve, reject) => {
        const worker = workers[slot];
        if (worker === undefined) {
          reject(new DecodeWorkerError(`Decode worker ${slot} is missing`));
          return;
        }
        const id = nextId++;
        waiting.set(id, { resolve, reject });
        worker.postMessage({ type: "read", id, region }, []);
      }),
  });

  const reports: (DecodeReport | null)[] = [];
  const readies: Promise<void>[] = [];
  for (let index = 0; index < pool.size; index++) {
    const worker = spawn(index);
    const bytes = channel();
    serveBytes(bytes.local, cache);
    ports.push(bytes.local);
    readies.push(
      new Promise<void>((resolve, reject) => {
        worker.addEventListener("message", (event) => {
          const reply = event.data;
          if (reply.type === "opened") {
            reports[index] = reply.report;
            resolve();
            return;
          }
          if (reply.type === "failed" && reply.id === null) {
            reject(new DecodeWorkerError(reply.message));
            return;
          }
          const waiter = waiting.get(reply.id as number);
          if (waiter === undefined) return;
          waiting.delete(reply.id as number);
          if (reply.type === "tile") {
            waiter.resolve({ data: reply.data, width: reply.width, height: reply.height });
          } else {
            waiter.reject(new DecodeWorkerError(reply.message));
          }
        });
      }),
    );
    worker.postMessage({ type: "open", request: options.request, bytes: bytes.remote }, [
      bytes.remote,
    ]);
    workers.push(worker);
  }
  const ready = Promise.all(readies).then(() => undefined);
  ready.catch(() => undefined);

  return {
    read: (region, centre, signal) => pool.request(regionKey(region), region, centre, signal),
    ready,
    jpegReports: () => [...reports],
    setFocus: (point) => pool.setFocus(point),
    stats: () => ({ ...pool.stats(), network: cache.stats() }),
    idle: () => pool.idle(),
    dispose() {
      pool.dispose();
      for (const worker of workers) worker.terminate();
      for (const port of ports) port.close?.();
      workers.length = 0;
      ports.length = 0;
      const error = new DecodeWorkerError("The decode workers were terminated");
      for (const waiter of waiting.values()) waiter.reject(error);
      waiting.clear();
    },
  };
}
