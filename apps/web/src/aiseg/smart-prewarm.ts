export const prewarmStillMs = 350;

export interface PrewarmTimers {
  readonly set: (run: () => void, ms: number) => unknown;
  readonly clear: (handle: unknown) => void;
}

export interface PrewarmTriggerOptions {
  readonly stillMs?: number;
  readonly timers?: PrewarmTimers;
  readonly pause: () => void;
  readonly fire: () => void;
}

export interface PrewarmTrigger {
  touch(): void;
  stop(): void;
}

const browserTimers: PrewarmTimers = {
  set: (run, ms) => setTimeout(run, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function createPrewarmTrigger(options: PrewarmTriggerOptions): PrewarmTrigger {
  const stillMs = options.stillMs ?? prewarmStillMs;
  const timers = options.timers ?? browserTimers;
  let handle: unknown = null;

  function cancel() {
    if (handle === null) return;
    timers.clear(handle);
    handle = null;
  }

  return {
    touch() {
      cancel();
      options.pause();
      handle = timers.set(() => {
        handle = null;
        options.fire();
      }, stillMs);
    },
    stop() {
      cancel();
      options.pause();
    },
  };
}
