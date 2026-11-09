export const defaultDecodeWorkers = 6;

export const defaultRetainedResults = 32;

export interface PoolPoint {
  readonly x: number;
  readonly y: number;
}

export type RunOnSlot<Job, Result> = (slot: number, job: Job) => Promise<Result>;

export interface DecodePoolOptions<Job, Result> {
  readonly run: RunOnSlot<Job, Result>;
  readonly size?: number;
  readonly retain?: number;
}

const recentDecodeCapacity = 128;

function percentileOf(values: readonly number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] ?? null;
}

export interface DecodePoolStats {
  readonly size: number;
  readonly queued: number;
  readonly active: number;
  readonly dispatched: number;
  readonly completed: number;
  readonly failed: number;
  readonly joined: number;
  readonly cancelledQueued: number;
  readonly orphanedInFlight: number;
  readonly lateKept: number;
  readonly lateUsed: number;
  readonly lateEvicted: number;
  readonly decodeP95Ms: number | null;
}

export interface PrefetchStats {
  readonly queued: number;
  readonly requested: number;
  readonly dropped: number;
  readonly started: number;
  readonly used: number;
  readonly joined: number;
}

export interface DecodePool<Job, Result> {
  readonly size: number;
  request(key: string, job: Job, centre: PoolPoint | null, signal?: AbortSignal): Promise<Result>;
  prefetch(key: string, job: Job, centre: PoolPoint | null): boolean;
  dropPrefetch(keep?: ReadonlySet<string>): number;
  prefetchStats(): PrefetchStats;
  setFocus(point: PoolPoint | null): void;
  stats(): DecodePoolStats;
  idle(): boolean;
  dispose(): void;
}

export class DecodePoolDisposedError extends Error {
  constructor() {
    super("The decode pool is disposed");
    this.name = "DecodePoolDisposedError";
  }
}

interface Waiter<Result> {
  readonly resolve: (result: Result) => void;
  readonly reject: (error: Error) => void;
  readonly detach: () => void;
}

interface Entry<Job, Result> {
  readonly key: string;
  readonly job: Job;
  readonly centre: PoolPoint | null;
  readonly order: number;
  readonly waiters: Set<Waiter<Result>>;
  state: "queued" | "active";
  low: boolean;
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The request was aborted", "AbortError");
}

function distanceSquared(a: PoolPoint, b: PoolPoint): number {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}

export function createDecodePool<Job, Result>(
  options: DecodePoolOptions<Job, Result>,
): DecodePool<Job, Result> {
  const size = options.size ?? defaultDecodeWorkers;
  if (!Number.isInteger(size) || size < 1) {
    throw new RangeError(`A decode pool needs at least one worker, got ${size}`);
  }
  const retain = options.retain ?? defaultRetainedResults;
  const entries = new Map<string, Entry<Job, Result>>();
  const queue: Entry<Job, Result>[] = [];
  const retained = new Map<string, Result>();
  const freeSlots = Array.from({ length: size }, (_, slot) => size - 1 - slot);
  const prefetched = new Set<string>();
  const prefetchCounts = { requested: 0, dropped: 0, started: 0, used: 0, joined: 0 };
  const lowSlots = Math.max(1, Math.floor(size / 2));
  let activeLow = 0;
  let focus: PoolPoint | null = null;
  let order = 0;
  let disposed = false;
  const startedAt = new Map<string, number>();
  const recentDecodeMs: number[] = [];
  const counts = {
    dispatched: 0,
    completed: 0,
    failed: 0,
    joined: 0,
    cancelledQueued: 0,
    orphanedInFlight: 0,
    lateKept: 0,
    lateUsed: 0,
    lateEvicted: 0,
  };

  const keep = (key: string, result: Result) => {
    retained.delete(key);
    retained.set(key, result);
    counts.lateKept++;
    while (retained.size > retain) {
      const oldest = retained.keys().next();
      if (oldest.done) break;
      retained.delete(oldest.value);
      prefetched.delete(oldest.value);
      counts.lateEvicted++;
    }
  };

  const nextIndex = (): number => {
    let best = 0;
    for (let index = 1; index < queue.length; index++) {
      const candidate = queue[index];
      const current = queue[best];
      if (candidate === undefined || current === undefined) continue;
      if (candidate.low !== current.low) {
        if (!candidate.low) best = index;
        continue;
      }
      if (focus === null || candidate.centre === null || current.centre === null) continue;
      const nearer =
        distanceSquared(candidate.centre, focus) - distanceSquared(current.centre, focus);
      if (nearer < 0 || (nearer === 0 && candidate.order < current.order)) best = index;
    }
    return best;
  };

  const settle = (entry: Entry<Job, Result>, outcome: PromiseSettledResult<Result>) => {
    if (disposed) return;
    entries.delete(entry.key);
    const started = startedAt.get(entry.key);
    startedAt.delete(entry.key);
    if (started !== undefined && outcome.status === "fulfilled") {
      recentDecodeMs.push(performance.now() - started);
      if (recentDecodeMs.length > recentDecodeCapacity) recentDecodeMs.shift();
    }
    const waiters = [...entry.waiters];
    entry.waiters.clear();
    if (outcome.status === "fulfilled") {
      counts.completed++;
      if (waiters.length === 0) keep(entry.key, outcome.value);
      for (const waiter of waiters) {
        waiter.detach();
        waiter.resolve(outcome.value);
      }
      return;
    }
    counts.failed++;
    const reason: unknown = outcome.reason;
    const error = reason instanceof Error ? reason : new Error(String(reason));
    for (const waiter of waiters) {
      waiter.detach();
      waiter.reject(error);
    }
  };

  const pump = () => {
    while (!disposed && queue.length > 0 && freeSlots.length > 0) {
      const index = nextIndex();
      const next = queue[index];
      if (next?.low === true && activeLow >= lowSlots) return;
      const [entry] = queue.splice(index, 1);
      const slot = freeSlots.pop();
      if (entry === undefined || slot === undefined) return;
      entry.state = "active";
      const wasLow = entry.low;
      if (wasLow) {
        prefetchCounts.started++;
        activeLow++;
      }
      counts.dispatched++;
      startedAt.set(entry.key, performance.now());
      let running: Promise<Result>;
      try {
        running = options.run(slot, entry.job);
      } catch (error) {
        running = Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
      running
        .then(
          (value) => settle(entry, { status: "fulfilled", value }),
          (reason: unknown) => settle(entry, { status: "rejected", reason }),
        )
        .finally(() => {
          if (wasLow) activeLow--;
          freeSlots.push(slot);
          pump();
        });
    }
  };

  const leave = (entry: Entry<Job, Result>, waiter: Waiter<Result>) => {
    if (!entry.waiters.delete(waiter) || entry.waiters.size > 0) return;
    if (entry.state === "queued") {
      const index = queue.indexOf(entry);
      if (index >= 0) queue.splice(index, 1);
      entries.delete(entry.key);
      counts.cancelledQueued++;
      return;
    }
    counts.orphanedInFlight++;
  };

  return {
    size,
    request(key, job, centre, signal) {
      if (disposed) return Promise.reject(new DecodePoolDisposedError());
      if (signal?.aborted) return Promise.reject(abortReason(signal));
      if (retained.has(key)) {
        const result = retained.get(key) as Result;
        retained.delete(key);
        counts.lateUsed++;
        if (prefetched.delete(key)) prefetchCounts.used++;
        return Promise.resolve(result);
      }
      let entry = entries.get(key);
      if (entry === undefined) {
        entry = {
          key,
          job,
          centre,
          order: order++,
          waiters: new Set(),
          state: "queued",
          low: false,
        };
        entries.set(key, entry);
        queue.push(entry);
      } else {
        counts.joined++;
        if (entry.low) {
          entry.low = false;
          prefetchCounts.joined++;
          prefetched.delete(key);
        }
      }
      const joined = entry;
      return new Promise<Result>((resolve, reject) => {
        const onAbort = () => {
          leave(joined, waiter);
          reject(abortReason(signal as AbortSignal));
        };
        const waiter: Waiter<Result> = {
          resolve,
          reject,
          detach: () => signal?.removeEventListener("abort", onAbort),
        };
        joined.waiters.add(waiter);
        signal?.addEventListener("abort", onAbort, { once: true });
        pump();
      });
    },
    prefetch(key, job, centre) {
      if (disposed || retained.has(key) || entries.has(key)) return false;
      const entry: Entry<Job, Result> = {
        key,
        job,
        centre,
        order: order++,
        waiters: new Set(),
        state: "queued",
        low: true,
      };
      entries.set(key, entry);
      queue.push(entry);
      prefetched.add(key);
      prefetchCounts.requested++;
      pump();
      return true;
    },
    dropPrefetch(keep) {
      let dropped = 0;
      for (let index = queue.length - 1; index >= 0; index--) {
        const entry = queue[index];
        if (entry === undefined || !entry.low || entry.waiters.size > 0) continue;
        if (keep?.has(entry.key)) continue;
        queue.splice(index, 1);
        entries.delete(entry.key);
        prefetched.delete(entry.key);
        dropped++;
      }
      prefetchCounts.dropped += dropped;
      return dropped;
    },
    prefetchStats() {
      return { queued: queue.filter((entry) => entry.low).length, ...prefetchCounts };
    },
    setFocus(point) {
      focus = point;
    },
    stats() {
      return {
        size,
        queued: queue.length,
        active: size - freeSlots.length,
        ...counts,
        decodeP95Ms: percentileOf(recentDecodeMs, 0.95),
      };
    },
    idle() {
      return queue.length === 0 && freeSlots.length === size;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      const error = new DecodePoolDisposedError();
      for (const entry of entries.values()) {
        for (const waiter of entry.waiters) {
          waiter.detach();
          waiter.reject(error);
        }
        entry.waiters.clear();
      }
      entries.clear();
      queue.length = 0;
      retained.clear();
      prefetched.clear();
    },
  };
}
