export type Cancel = () => void;

export interface TabVisibility {
  hidden(): boolean;
  subscribe(listener: () => void): Cancel;
}

export interface TimerScheduler {
  after(callback: () => void, ms: number): Cancel;
}

export interface TaskScheduler {
  run(callback: () => void): Cancel;
}

export interface SchedulingOptions {
  readonly visibility?: TabVisibility;
  readonly timers?: TimerScheduler;
  readonly tasks?: TaskScheduler;
  readonly watchdogMs?: number;
}

export const defaultWatchdogMs = 500;

const noEvents: Cancel = () => {};

export const documentVisibility: TabVisibility = {
  hidden: () => typeof document !== "undefined" && document.visibilityState === "hidden",
  subscribe: (listener) => {
    if (typeof document === "undefined") return noEvents;
    document.addEventListener("visibilitychange", listener);
    globalThis.addEventListener("pageshow", listener);
    return () => {
      document.removeEventListener("visibilitychange", listener);
      globalThis.removeEventListener("pageshow", listener);
    };
  },
};

export const systemTimers: TimerScheduler = {
  after: (callback, ms) => {
    const handle = globalThis.setTimeout(callback, ms);
    return () => globalThis.clearTimeout(handle);
  },
};

interface QueuedTask {
  live: boolean;
  readonly callback: () => void;
}

function createMessageTasks(): TaskScheduler {
  const queue: QueuedTask[] = [];
  let channel: MessageChannel | null = null;

  const close = () => {
    channel?.port1.close();
    channel?.port2.close();
    channel = null;
  };

  const drain = () => {
    const task = queue.shift();
    if (queue.length === 0) close();
    if (task?.live) task.callback();
  };

  return {
    run: (callback) => {
      const task: QueuedTask = { live: true, callback };
      queue.push(task);
      if (channel === null) {
        channel = new MessageChannel();
        channel.port1.onmessage = drain;
      }
      channel.port2.postMessage(null);
      return () => {
        task.live = false;
      };
    },
  };
}

export const messageTasks: TaskScheduler = createMessageTasks();

interface SchedulerLike {
  yield?: () => Promise<void>;
}

export function yieldToMain(tasks: TaskScheduler = messageTasks): Promise<void> {
  const scheduler = (globalThis as { scheduler?: SchedulerLike }).scheduler;
  if (typeof scheduler?.yield === "function") return scheduler.yield();
  return new Promise((resolve) => {
    tasks.run(resolve);
  });
}

export interface TimeSlice {
  checkpoint(): Promise<boolean>;
}

export function createTimeSlice(
  budgetMs: number,
  now: () => number,
  yielder: () => Promise<void> = yieldToMain,
): TimeSlice {
  let started = now();
  return {
    checkpoint: async () => {
      if (now() - started < budgetMs) return false;
      await yielder();
      started = now();
      return true;
    },
  };
}
