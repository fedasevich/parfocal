import { cancelGpuCall, type GpuWaiting } from "@parfocal/api-client";

export type GpuWaitKind = "typer" | "view-map" | "encoder";

export interface GpuWait {
  readonly id: number;
  readonly kind: GpuWaitKind;
  readonly waitedSeconds: number;
  readonly cancel: () => void;
}

export type GpuOutcome<T> = { readonly answered: T } | { readonly waiting: GpuWaiting };

export type GpuAttempt<T> = (call: string | null, signal: AbortSignal) => Promise<GpuOutcome<T>>;

export type GpuCancel = (call: string) => Promise<unknown>;

export class GpuCallCancelledError extends Error {
  constructor() {
    super("The GPU call was cancelled");
    this.name = "GpuCallCancelledError";
  }
}

let waits: readonly GpuWait[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function publish(next: readonly GpuWait[]): void {
  waits = next;
  for (const listener of listeners) listener();
}

function put(wait: GpuWait): void {
  publish([...waits.filter((each) => each.id !== wait.id), wait]);
}

function drop(id: number): void {
  if (waits.some((each) => each.id === id)) publish(waits.filter((each) => each.id !== id));
}

export const gpuWaits = {
  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  current: (): readonly GpuWait[] => waits,
  cancelAll: (): void => {
    for (const wait of waits) wait.cancel();
  },
};

export const serverGpuCancel: GpuCancel = (call) => cancelGpuCall(call);

export async function untilGpuAnswers<T>(
  kind: GpuWaitKind,
  attempt: GpuAttempt<T>,
  cancelCall: GpuCancel = serverGpuCancel,
): Promise<T> {
  const id = nextId++;
  const controller = new AbortController();
  let call: string | null = null;
  let cancelled = false;
  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    controller.abort();
    drop(id);
    if (call !== null) void cancelCall(call).catch(() => undefined);
  };
  try {
    for (;;) {
      if (cancelled) throw new GpuCallCancelledError();
      const outcome = await attempt(call, controller.signal);
      if (cancelled) throw new GpuCallCancelledError();
      if ("answered" in outcome) return outcome.answered;
      call = outcome.waiting.call;
      put({ id, kind, waitedSeconds: outcome.waiting.waited_seconds, cancel });
    }
  } catch (error) {
    throw cancelled ? new GpuCallCancelledError() : error;
  } finally {
    drop(id);
  }
}
