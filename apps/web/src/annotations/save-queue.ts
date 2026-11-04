export type Remote = { id: string | null; version: number };

export type Outcome<T> =
  | { readonly kind: "done"; readonly value: T }
  | { readonly kind: "retry" }
  | { readonly kind: "rejected" };

export type Transport<Body> = {
  readonly create: (body: Body) => Promise<Outcome<{ id: string; version: number }>>;
  readonly remove: (id: string, version: number) => Promise<Outcome<null>>;
};

export type QueuePhase = "idle" | "saving" | "saved" | "retrying" | "failed";

export type QueueStatus = {
  readonly phase: QueuePhase;
  readonly waiting: number;
  readonly attempt: number;
};

type Operation<Body> =
  | { readonly kind: "create"; readonly remote: Remote; readonly body: Body }
  | { readonly kind: "remove"; readonly remote: Remote };

export type Timers = {
  readonly set: (run: () => void, ms: number) => unknown;
  readonly clear: (handle: unknown) => void;
};

export type QueueOptions = {
  readonly batchMs?: number;
  readonly retryMs?: readonly number[];
  readonly timers?: Timers;
};

export const defaultRetryMs: readonly number[] = [1000, 2000, 4000, 8000];

export const classifyStatus = (status: number): "done" | "retry" | "rejected" => {
  if (status >= 200 && status < 300) return "done";
  if (status === 408 || status === 429 || status >= 500) return "retry";
  return "rejected";
};

export type SaveQueue<Body> = {
  readonly enqueueCreate: (remote: Remote, body: Body) => void;
  readonly enqueueRemove: (remote: Remote) => void;
  readonly flushNow: () => void;
  readonly status: () => QueueStatus;
  readonly subscribe: (listener: () => void) => () => void;
};

export function createSaveQueue<Body>(
  transport: Transport<Body>,
  options: QueueOptions = {},
): SaveQueue<Body> {
  const batchMs = options.batchMs ?? 250;
  const retryMs = options.retryMs ?? defaultRetryMs;
  const timers: Timers = options.timers ?? {
    set: (run, ms) => setTimeout(run, ms),
    clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
  const pending: Operation<Body>[] = [];
  const listeners = new Set<() => void>();
  let inFlight: Operation<Body> | null = null;
  let timer: unknown = null;
  let draining = false;
  let attempt = 0;
  let phase: QueuePhase = "idle";
  let snapshot: QueueStatus = { phase, waiting: 0, attempt: 0 };

  const publish = () => {
    const waiting = pending.length + (inFlight === null ? 0 : 1);
    if (snapshot.phase === phase && snapshot.waiting === waiting && snapshot.attempt === attempt)
      return;
    snapshot = { phase, waiting, attempt };
    for (const listener of listeners) listener();
  };

  const schedule = (ms: number) => {
    if (timer !== null) timers.clear(timer);
    timer = timers.set(() => {
      timer = null;
      void drain();
    }, ms);
  };

  const perform = async (operation: Operation<Body>): Promise<"done" | "retry" | "rejected"> => {
    try {
      if (operation.kind === "create") {
        const outcome = await transport.create(operation.body);
        if (outcome.kind === "done") {
          operation.remote.id = outcome.value.id;
          operation.remote.version = outcome.value.version;
        }
        return outcome.kind;
      }
      const { id, version } = operation.remote;
      if (id === null) return "done";
      return (await transport.remove(id, version)).kind;
    } catch {
      return "retry";
    }
  };

  const drain = async (): Promise<void> => {
    if (draining) return;
    draining = true;
    let rejected = false;
    while (pending.length > 0) {
      const operation = pending[0];
      if (operation === undefined) break;
      inFlight = operation;
      pending.shift();
      phase = attempt === 0 ? "saving" : "retrying";
      publish();
      const result = await perform(operation);
      inFlight = null;
      if (result === "retry") {
        pending.unshift(operation);
        phase = "retrying";
        const wait = retryMs[Math.min(attempt, retryMs.length - 1)] ?? 1000;
        attempt += 1;
        draining = false;
        publish();
        schedule(wait);
        return;
      }
      attempt = 0;
      if (result === "rejected") rejected = true;
    }
    draining = false;
    phase = rejected ? "failed" : "saved";
    publish();
  };

  const enqueueCreate = (remote: Remote, body: Body) => {
    pending.push({ kind: "create", remote, body });
    if (phase === "idle" || phase === "saved" || phase === "failed") phase = "saving";
    publish();
    if (!draining && timer === null) schedule(batchMs);
  };

  const enqueueRemove = (remote: Remote) => {
    const index = pending.findIndex(
      (operation) => operation.kind === "create" && operation.remote === remote,
    );
    if (index >= 0) {
      pending.splice(index, 1);
      if (pending.length === 0 && !draining && timer !== null) {
        timers.clear(timer);
        timer = null;
        attempt = 0;
        phase = "saved";
      }
      publish();
      return;
    }
    pending.push({ kind: "remove", remote });
    if (phase === "idle" || phase === "saved" || phase === "failed") phase = "saving";
    publish();
    if (!draining && timer === null) schedule(batchMs);
  };

  const flushNow = () => {
    if (pending.length === 0 || draining) return;
    if (timer !== null) {
      timers.clear(timer);
      timer = null;
    }
    void drain();
  };

  return {
    enqueueCreate,
    enqueueRemove,
    flushNow,
    status: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
