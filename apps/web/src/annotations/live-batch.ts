import type { Timers } from "./save-queue.ts";
import type { SavedRecord } from "./saved-shapes.ts";

export type LayerRecord = SavedRecord & {
  readonly id: string;
  readonly version: number;
  readonly changed_by_user_id?: string | null;
};

export type LiveChange =
  | { readonly kind: "add"; readonly annotationId: string; readonly record: LayerRecord }
  | { readonly kind: "edit"; readonly annotationId: string; readonly record: LayerRecord }
  | { readonly kind: "remove"; readonly annotationId: string; readonly by: string | null };

export type ChangeSummary = {
  readonly by: string | null;
  readonly added: number;
  readonly changed: number;
  readonly removed: number;
};

export const quietMs = 3000;

export type PlanInput = {
  readonly known: ReadonlyMap<string, number>;
  readonly records: readonly LayerRecord[];
  readonly me: string | null;
  readonly deletedHere: ReadonlySet<string>;
};

export function planChanges({ known, records, me, deletedHere }: PlanInput): LiveChange[] {
  const changes: LiveChange[] = [];
  const present = new Set<string>();
  for (const record of records) {
    present.add(record.id);
    const version = known.get(record.id);
    const mine = me !== null && record.changed_by_user_id === me;
    if (version === undefined) {
      if (!mine && !deletedHere.has(record.id)) {
        changes.push({ kind: "add", annotationId: record.id, record });
      }
    } else if (record.version > version && !mine) {
      changes.push({ kind: "edit", annotationId: record.id, record });
    }
  }
  for (const id of known.keys()) {
    if (!present.has(id)) changes.push({ kind: "remove", annotationId: id, by: null });
  }
  return changes;
}

export const changeAuthor = (change: LiveChange): string | null =>
  change.kind === "remove" ? change.by : (change.record.changed_by_user_id ?? null);

export function summarise(changes: readonly LiveChange[]): ChangeSummary[] {
  const byAuthor = new Map<string | null, { added: number; changed: number; removed: number }>();
  for (const change of changes) {
    const author = changeAuthor(change);
    const tally = byAuthor.get(author) ?? { added: 0, changed: 0, removed: 0 };
    if (change.kind === "add") tally.added += 1;
    else if (change.kind === "edit") tally.changed += 1;
    else tally.removed += 1;
    byAuthor.set(author, tally);
  }
  return [...byAuthor].map(([by, tally]) => ({ by, ...tally }));
}

export type LiveBatchHost = {
  readonly known: () => ReadonlyMap<string, number>;
  readonly me: () => string | null;
  readonly deletedHere: () => ReadonlySet<string>;
  readonly busy: () => boolean;
  readonly protectedIds: () => ReadonlySet<string>;
  readonly apply: (changes: readonly LiveChange[]) => void;
  readonly timers?: Timers;
  readonly quietMs?: number;
};

export type LiveBatch = {
  readonly offer: (records: readonly LayerRecord[]) => void;
  readonly recheck: () => void;
  readonly touch: () => void;
  readonly flushNow: () => void;
  readonly pending: () => readonly LiveChange[];
  readonly subscribe: (listener: () => void) => () => void;
  readonly dispose: () => void;
};

const realTimers: Timers = {
  set: (run, ms) => setTimeout(run, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

const sameChanges = (before: readonly LiveChange[], after: readonly LiveChange[]): boolean =>
  before.length === after.length &&
  after.every((change, index) => {
    const previous = before[index];
    if (previous === undefined) return false;
    if (previous.kind !== change.kind || previous.annotationId !== change.annotationId) {
      return false;
    }
    if (previous.kind === "remove" || change.kind === "remove") return true;
    return previous.record.version === change.record.version;
  });

export function createLiveBatch(host: LiveBatchHost): LiveBatch {
  const timers = host.timers ?? realTimers;
  const wait = host.quietMs ?? quietMs;
  const listeners = new Set<() => void>();
  let records: readonly LayerRecord[] = [];
  let handle: unknown = null;
  let cached: readonly LiveChange[] = [];

  const plan = () =>
    planChanges({
      known: host.known(),
      records,
      me: host.me(),
      deletedHere: host.deletedHere(),
    });

  const clear = () => {
    if (handle === null) return;
    timers.clear(handle);
    handle = null;
  };

  const recheck = () => {
    const next = plan();
    if (sameChanges(cached, next)) return;
    cached = next;
    for (const listener of listeners) listener();
  };

  const flush = () => {
    const held = host.protectedIds();
    const ready = plan().filter((change) => !held.has(change.annotationId));
    if (ready.length > 0) host.apply(ready);
    recheck();
  };

  const schedule = () => {
    clear();
    if (cached.length === 0) return;
    handle = timers.set(() => {
      handle = null;
      if (!host.busy()) flush();
      schedule();
    }, wait);
  };

  return {
    offer: (next) => {
      records = next;
      recheck();
      if (handle === null) schedule();
    },
    recheck,
    touch: () => {
      if (cached.length > 0) schedule();
    },
    flushNow: () => {
      clear();
      flush();
      schedule();
    },
    pending: () => cached,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose: () => {
      clear();
      listeners.clear();
    },
  };
}
