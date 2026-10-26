import type { Cancel, TabVisibility, TimerScheduler } from "../engine/scheduling.ts";

export type GpuStatus = "ready" | "lost" | "failed";

export type GpuFailureReason = "restore-timeout" | "repeated-loss" | "rebuild-failed";

export const defaultRestoreTimeoutMs = 5000;

export const defaultMaxLossesInWindow = 3;

export const defaultLossWindowMs = 30_000;

export const gpuFailureMessage =
  "The slide view lost its graphics connection and could not recover. Reload the page to continue.";

export class GpuUnrecoverableError extends Error {
  readonly reason: GpuFailureReason;
  readonly userMessage: string;

  constructor(reason: GpuFailureReason, options?: { readonly cause?: unknown }) {
    super(`The WebGL context could not be recovered (${reason})`, options);
    this.name = "GpuUnrecoverableError";
    this.reason = reason;
    this.userMessage = gpuFailureMessage;
  }
}

export function isGpuUnrecoverableError(error: unknown): error is GpuUnrecoverableError {
  return error instanceof GpuUnrecoverableError;
}

export interface GpuEventSource {
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
}

export interface GpuGuardOptions {
  readonly timers: TimerScheduler;
  readonly visibility: TabVisibility;
  readonly now: () => number;
  readonly onLost: () => void;
  readonly rebuild: () => void;
  readonly onUnrecoverable: (error: GpuUnrecoverableError) => void;
  readonly restoreTimeoutMs?: number;
  readonly maxLossesInWindow?: number;
  readonly lossWindowMs?: number;
}

export interface GpuGuardStats {
  readonly losses: number;
  readonly recoveries: number;
}

export interface GpuGuard {
  readonly attach: (source: GpuEventSource) => void;
  readonly status: () => GpuStatus;
  readonly stats: () => GpuGuardStats;
  readonly destroy: () => void;
}

export function createGpuGuard(options: GpuGuardOptions): GpuGuard {
  const { timers, visibility, now } = options;
  const restoreTimeoutMs = options.restoreTimeoutMs ?? defaultRestoreTimeoutMs;
  const maxLossesInWindow = options.maxLossesInWindow ?? defaultMaxLossesInWindow;
  const lossWindowMs = options.lossWindowMs ?? defaultLossWindowMs;

  let status: GpuStatus = "ready";
  let source: GpuEventSource | null = null;
  let cancelTimer: Cancel | null = null;
  let recentLosses: number[] = [];
  let losses = 0;
  let recoveries = 0;
  let destroyed = false;

  const stopTimer = () => {
    cancelTimer?.();
    cancelTimer = null;
  };

  const fail = (reason: GpuFailureReason, cause?: unknown) => {
    if (status === "failed" || destroyed) return;
    status = "failed";
    stopTimer();
    detach();
    options.onUnrecoverable(
      new GpuUnrecoverableError(reason, cause === undefined ? {} : { cause }),
    );
  };

  const startTimer = () => {
    stopTimer();
    if (status !== "lost" || visibility.hidden()) return;
    cancelTimer = timers.after(() => {
      cancelTimer = null;
      fail("restore-timeout");
    }, restoreTimeoutMs);
  };

  const lost = (event: Event) => {
    if (status === "failed" || destroyed) return;
    event.preventDefault();
    const time = now();
    losses += 1;
    recentLosses = [...recentLosses.filter((at) => time - at < lossWindowMs), time];
    if (recentLosses.length > maxLossesInWindow) {
      fail("repeated-loss");
      return;
    }
    status = "lost";
    options.onLost();
    startTimer();
  };

  const restored = () => {
    if (status !== "lost" || destroyed) return;
    stopTimer();
    status = "ready";
    try {
      options.rebuild();
      recoveries += 1;
    } catch (error) {
      fail("rebuild-failed", error);
    }
  };

  const stopVisibility = visibility.subscribe(() => {
    if (status !== "lost") return;
    if (visibility.hidden()) stopTimer();
    else startTimer();
  });

  function detach() {
    source?.removeEventListener("webglcontextlost", lost);
    source?.removeEventListener("webglcontextrestored", restored);
    source = null;
  }

  return {
    attach: (next) => {
      if (destroyed || status === "failed") return;
      detach();
      source = next;
      next.addEventListener("webglcontextlost", lost);
      next.addEventListener("webglcontextrestored", restored);
    },
    status: () => status,
    stats: () => ({ losses, recoveries }),
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      stopTimer();
      detach();
      stopVisibility();
    },
  };
}
