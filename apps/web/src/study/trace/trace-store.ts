import type { TraceBatch, TraceEvent } from "./trace-model.ts";

export type TraceSink = {
  put: (batch: TraceBatch) => Promise<void>;
  read: (sessionId: string) => Promise<TraceBatch[]>;
};

export const uploadIntervalMs = 60_000;

export function memorySink(): TraceSink & { batches: TraceBatch[] } {
  const batches: TraceBatch[] = [];
  return {
    batches,
    put: (batch) => {
      batches.push(batch);
      return Promise.resolve();
    },
    read: (sessionId) => Promise.resolve(batches.filter((batch) => batch.sessionId === sessionId)),
  };
}

const databaseName = "parfocal-study-trace";
const storeName = "batches";

const openDatabase = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(storeName, { keyPath: ["sessionId", "index"] });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("The trace store did not open"));
  });

const finished = (transaction: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("The trace store failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("The trace store aborted"));
  });

export const indexedDbSink = (): TraceSink => ({
  put: async (batch) => {
    const database = await openDatabase();
    const transaction = database.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).put(batch);
    await finished(transaction);
    database.close();
  },
  read: async (sessionId) => {
    const database = await openDatabase();
    const request = database
      .transaction(storeName, "readonly")
      .objectStore(storeName)
      .getAll(IDBKeyRange.bound([sessionId, 0], [sessionId, Number.MAX_SAFE_INTEGER]));
    const batches = await new Promise<TraceBatch[]>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result as TraceBatch[]);
      request.onerror = () => reject(request.error ?? new Error("The trace store failed"));
    });
    database.close();
    return batches;
  },
});

export type Batcher = {
  push: (event: TraceEvent) => void;
  flush: () => Promise<void>;
  stop: () => Promise<void>;
};

export type Schedule = (run: () => void, ms: number) => () => void;

const windowSchedule: Schedule = (run, ms) => {
  const id = window.setInterval(run, ms);
  return () => window.clearInterval(id);
};

export function createBatcher(
  sessionId: string,
  sink: TraceSink,
  schedule: Schedule = windowSchedule,
  intervalMs = uploadIntervalMs,
): Batcher {
  let pending: TraceEvent[] = [];
  let index = 0;
  let queue: Promise<void> = Promise.resolve();

  const flush = () => {
    if (pending.length === 0) return queue;
    const batch: TraceBatch = { sessionId, index, events: pending };
    index += 1;
    pending = [];
    queue = queue.then(() => sink.put(batch)).catch(() => undefined);
    return queue;
  };

  const cancel = schedule(() => void flush(), intervalMs);

  return {
    push: (event) => {
      pending.push(event);
    },
    flush,
    stop: () => {
      cancel();
      return flush();
    },
  };
}
