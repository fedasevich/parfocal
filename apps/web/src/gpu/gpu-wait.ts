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

export interface GpuWaitOptions {
  readonly showAfterMs?: number;
  readonly signal?: AbortSignal;
  readonly now?: () => number;
}

export const gpuWaitTickMs = 1000;

export async function untilGpuAnswers<T>(
  kind: GpuWaitKind,
  attempt: GpuAttempt<T>,
  cancelCall: GpuCancel = serverGpuCancel,
  options: GpuWaitOptions = {},
): Promise<T> {
  const id = nextId++;
  const controller = new AbortController();
  const now = options.now ?? (() => Date.now());
  const started = now();
  let serverWaited = 0;
  let call: string | null = null;
  let cancelled = false;
  let ticker: ReturnType<typeof setInterval> | null = null;
  const show = () => {
    const waitedSeconds = Math.max(serverWaited, (now() - started) / 1000);
    put({ id, kind, waitedSeconds, cancel });
  };
  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    controller.abort();
    drop(id);
    if (call !== null) void cancelCall(call).catch(() => undefined);
  };
  const reveal =
    options.showAfterMs === undefined
      ? null
      : setTimeout(() => {
          show();
          ticker = setInterval(show, gpuWaitTickMs);
        }, options.showAfterMs);
  const outside = options.signal;
  if (outside?.aborted) cancel();
  outside?.addEventListener("abort", cancel);
  try {
    for (;;) {
      if (cancelled) throw new GpuCallCancelledError();
      const outcome = await attempt(call, controller.signal);
      if (cancelled) throw new GpuCallCancelledError();
      if ("answered" in outcome) return outcome.answered;
      call = outcome.waiting.call;
      serverWaited = outcome.waiting.waited_seconds;
      show();
    }
  } catch (error) {
    throw cancelled ? new GpuCallCancelledError() : error;
  } finally {
    if (reveal !== null) clearTimeout(reveal);
    if (ticker !== null) clearInterval(ticker);
    outside?.removeEventListener("abort", cancel);
    drop(id);
  }
}

export const holdGpuWaitEvent = "parfocal:hold-gpu-wait";

export function holdGpuWait(seconds: number): void {
  const noCancel: GpuCancel = () => Promise.resolve();
  const attempt: GpuAttempt<never> = (call, signal) => {
    if (call === null) {
      return Promise.resolve({
        waiting: { call: "held", waited_seconds: seconds, hold_seconds: 1 },
      });
    }
    return new Promise((_, reject) =>
      signal.addEventListener("abort", () => reject(new GpuCallCancelledError())),
    );
  };
  void untilGpuAnswers("view-map", attempt, noCancel).catch(() => undefined);
}
