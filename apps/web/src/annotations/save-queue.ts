export type Remote = { id: string | null; version: number };

export type Theirs = {
  readonly version: number;
  readonly deleted: boolean;
  readonly geometry: Readonly<Record<string, unknown>>;
  readonly classId: string | null;
  readonly changedBy: string | null;
  readonly kind?: string | null;
  readonly text?: string | null;
};

export type Outcome<T> =
  | { readonly kind: "done"; readonly value: T }
  | { readonly kind: "retry" }
  | { readonly kind: "rejected" }
  | { readonly kind: "conflict"; readonly theirs: Theirs };

export type Transport<Body> = {
  readonly create: (body: Body) => Promise<Outcome<{ id: string; version: number }>>;
  readonly update: (
    id: string,
    version: number,
    body: Body,
  ) => Promise<Outcome<{ version: number }>>;
  readonly remove: (id: string, version: number) => Promise<Outcome<null>>;
};

export type QueuePhase = "idle" | "saving" | "saved" | "retrying" | "failed" | "conflict";

export type QueueStatus = {
  readonly phase: QueuePhase;
  readonly waiting: number;
  readonly attempt: number;
  readonly conflicts: number;
};

export type Conflict<Body> = {
  readonly remote: Remote;
  readonly action: "update" | "remove";
  readonly theirs: Theirs;
  mine: Body | null;
};

export type Choice = "mine" | "theirs";

type Operation<Body> =
  | { readonly kind: "create"; readonly remote: Remote; body: Body }
  | { readonly kind: "update"; readonly remote: Remote; body: Body }
  | { readonly kind: "remove"; readonly remote: Remote };

type Performed =
  | { readonly kind: "done" | "retry" | "rejected" }
  | { readonly kind: "conflict"; readonly theirs: Theirs };

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
  readonly enqueueUpdate: (remote: Remote, body: Body) => void;
  readonly enqueueRemove: (remote: Remote) => void;
  readonly resolve: (conflict: Conflict<Body>, choice: Choice) => void;
  readonly conflicts: () => readonly Conflict<Body>[];
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
  let open: readonly Conflict<Body>[] = [];
  let inFlight: Operation<Body> | null = null;
  let timer: unknown = null;
  let draining = false;
  let attempt = 0;
  let phase: QueuePhase = "idle";
  let snapshot: QueueStatus = { phase, waiting: 0, attempt: 0, conflicts: 0 };

  const publish = () => {
    const waiting = pending.length + (inFlight === null ? 0 : 1);
    const conflicts = open.length;
    if (
      snapshot.phase === phase &&
      snapshot.waiting === waiting &&
      snapshot.attempt === attempt &&
      snapshot.conflicts === conflicts
    )
      return;
    snapshot = { phase, waiting, attempt, conflicts };
    for (const listener of listeners) listener();
  };

  const resting = () =>
    phase === "idle" || phase === "saved" || phase === "failed" || phase === "conflict";

  const schedule = (ms: number) => {
    if (timer !== null) timers.clear(timer);
    timer = timers.set(() => {
      timer = null;
      void drain();
    }, ms);
  };

  const perform = async (operation: Operation<Body>): Promise<Performed> => {
    try {
      if (operation.kind === "create") {
        const outcome = await transport.create(operation.body);
        if (outcome.kind === "done") {
          operation.remote.id = outcome.value.id;
          operation.remote.version = outcome.value.version;
        }
        return outcome.kind === "conflict" ? outcome : { kind: outcome.kind };
      }
      const { id, version } = operation.remote;
      if (id === null) return { kind: "done" };
      if (operation.kind === "update") {
        const outcome = await transport.update(id, version, operation.body);
        if (outcome.kind === "done") operation.remote.version = outcome.value.version;
        return outcome.kind === "conflict" ? outcome : { kind: outcome.kind };
      }
      const outcome = await transport.remove(id, version);
      return outcome.kind === "conflict" ? outcome : { kind: outcome.kind };
    } catch {
      return { kind: "retry" };
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
      if (result.kind === "retry") {
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
      if (result.kind === "rejected") rejected = true;
      if (result.kind === "conflict" && operation.kind !== "create") {
        open = [
          ...open,
          {
            remote: operation.remote,
            action: operation.kind,
            theirs: result.theirs,
            mine: operation.kind === "update" ? operation.body : null,
          },
        ];
      }
    }
    draining = false;
    phase = rejected ? "failed" : open.length > 0 ? "conflict" : "saved";
    publish();
  };

  const startSoon = () => {
    if (resting()) phase = "saving";
    publish();
    if (!draining && timer === null) schedule(batchMs);
  };

  const settleIfIdle = () => {
    if (pending.length > 0 || draining || inFlight !== null) return;
    if (timer !== null) {
      timers.clear(timer);
      timer = null;
    }
    attempt = 0;
    phase = open.length > 0 ? "conflict" : "saved";
  };

  const enqueueCreate = (remote: Remote, body: Body) => {
    pending.push({ kind: "create", remote, body });
    startSoon();
  };

  const enqueueUpdate = (remote: Remote, body: Body) => {
    const held = open.find((conflict) => conflict.remote === remote);
    if (held !== undefined) {
      held.mine = body;
      return;
    }
    for (const operation of pending) {
      if (operation.kind !== "remove" && operation.remote === remote) {
        operation.body = body;
        return;
      }
    }
    pending.push({ kind: "update", remote, body });
    startSoon();
  };

  const enqueueRemove = (remote: Remote) => {
    const held = open.find((conflict) => conflict.remote === remote);
    if (held !== undefined) {
      open = open.filter((conflict) => conflict !== held);
      remote.version = held.theirs.version;
      if (held.theirs.deleted) {
        settleIfIdle();
        publish();
        return;
      }
    }
    for (let index = pending.length - 1; index >= 0; index -= 1) {
      const operation = pending[index];
      if (operation?.remote !== remote) continue;
      if (operation.kind === "update") pending.splice(index, 1);
      if (operation.kind === "create") {
        pending.splice(index, 1);
        settleIfIdle();
        publish();
        return;
      }
    }
    pending.push({ kind: "remove", remote });
    startSoon();
  };

  const resolve = (conflict: Conflict<Body>, choice: Choice) => {
    if (!open.includes(conflict)) return;
    open = open.filter((item) => item !== conflict);
    const { remote, theirs } = conflict;
    remote.version = theirs.version;
    if (choice === "mine") {
      if (conflict.action === "remove") {
        if (!theirs.deleted) {
          enqueueRemove(remote);
          return;
        }
      } else if (conflict.mine !== null) {
        if (theirs.deleted) {
          remote.id = null;
          remote.version = 1;
          enqueueCreate(remote, conflict.mine);
        } else {
          enqueueUpdate(remote, conflict.mine);
        }
        return;
      }
    }
    settleIfIdle();
    publish();
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
    enqueueUpdate,
    enqueueRemove,
    resolve,
    conflicts: () => open,
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
