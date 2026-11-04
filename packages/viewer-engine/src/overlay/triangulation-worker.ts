import type { PolygonBatch } from "./batch-types.ts";
import { createPolygonBatch, type FlatBatch } from "./batches.ts";

export type TriangulationReply =
  | { readonly ok: true; readonly batch: PolygonBatch }
  | { readonly ok: false; readonly message: string };

export interface TriangulationScope {
  addEventListener(type: "message", listener: (event: MessageEvent<FlatBatch>) => void): void;
  postMessage(message: TriangulationReply, transfer: Transferable[]): void;
}

function buffersOf(batch: PolygonBatch): Transferable[] {
  return [
    batch.positions.buffer,
    batch.starts.buffer,
    batch.colors.buffer,
    batch.holeStarts.buffer,
    batch.indices.buffer,
  ];
}

export function startTriangulationWorker(scope: TriangulationScope): void {
  scope.addEventListener("message", (event) => {
    try {
      const batch = createPolygonBatch(event.data);
      scope.postMessage({ ok: true, batch }, buffersOf(batch));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Triangulation failed";
      scope.postMessage({ ok: false, message }, []);
    }
  });
}

export interface TriangulationWorker {
  postMessage(message: FlatBatch, transfer: Transferable[]): void;
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<TriangulationReply>) => void,
  ): void;
  addEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  terminate(): void;
}

export function spawnTriangulationWorker(): TriangulationWorker {
  return new Worker(new URL("../workers/triangulate.worker.ts", import.meta.url), {
    type: "module",
    name: "parfocal-triangulate",
  });
}

export interface WorkerBatchOptions {
  readonly spawn?: () => TriangulationWorker;
}

export function createPolygonBatchInWorker(
  batch: FlatBatch,
  options: WorkerBatchOptions = {},
): Promise<PolygonBatch> {
  const worker = (options.spawn ?? spawnTriangulationWorker)();
  return new Promise<PolygonBatch>((resolve, reject) => {
    worker.addEventListener("message", (event) => {
      worker.terminate();
      if (event.data.ok) resolve(event.data.batch);
      else reject(new RangeError(event.data.message));
    });
    worker.addEventListener("error", (event) => {
      worker.terminate();
      reject(new Error(event.message || "The triangulation worker failed"));
    });
    const transfer: Transferable[] = [
      batch.positions.buffer,
      batch.starts.buffer,
      batch.colors.buffer,
    ];
    if (batch.holeStarts) transfer.push(batch.holeStarts.buffer);
    worker.postMessage(batch, transfer);
  });
}
