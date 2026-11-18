import type { Cancel, TabVisibility, TaskScheduler, TimerScheduler } from "./scheduling.ts";
import type { FrameScheduler } from "./types.ts";

export interface GuardedFramesOptions {
  readonly frames: FrameScheduler;
  readonly visibility: TabVisibility;
  readonly tasks: TaskScheduler;
  readonly timers: TimerScheduler | null;
  readonly watchdogMs: number;
}

export interface GuardedFrameStats {
  readonly fromFrame: number;
  readonly fromWatchdog: number;
  readonly fromTask: number;
  readonly restarts: number;
}

export interface GuardedFrames extends FrameScheduler {
  restart(): void;
  pending(): number;
  stats(): GuardedFrameStats;
}

type Source = "fromFrame" | "fromWatchdog" | "fromTask";

interface Entry {
  readonly callback: () => void;
  generation: number;
  disarm: Cancel | null;
}

export function createGuardedFrames(options: GuardedFramesOptions): GuardedFrames {
  const { frames, visibility, tasks, timers, watchdogMs } = options;
  const entries = new Map<number, Entry>();
  const counts = { fromFrame: 0, fromWatchdog: 0, fromTask: 0, restarts: 0 };
  let nextId = 1;
  let generation = 0;

  const fire = (id: number, armed: number, source: Source) => {
    const entry = entries.get(id);
    if (entry === undefined || entry.generation !== armed) return;
    entry.disarm?.();
    entries.delete(id);
    counts[source] += 1;
    entry.callback();
  };

  const arm = (id: number, entry: Entry) => {
    const armed = entry.generation;
    if (visibility.hidden()) {
      entry.disarm = tasks.run(() => fire(id, armed, "fromTask"));
      return;
    }
    const handle = frames.request(() => fire(id, armed, "fromFrame"));
    const stopWatchdog = timers?.after(() => fire(id, armed, "fromWatchdog"), watchdogMs);
    entry.disarm = () => {
      frames.cancel(handle);
      stopWatchdog?.();
    };
  };

  const disarm = (entry: Entry) => {
    entry.disarm?.();
    entry.disarm = null;
  };

  return {
    request: (callback) => {
      const id = nextId++;
      const entry: Entry = { callback, generation, disarm: null };
      entries.set(id, entry);
      arm(id, entry);
      return id;
    },
    cancel: (id) => {
      const entry = entries.get(id);
      if (entry === undefined) return;
      disarm(entry);
      entries.delete(id);
    },
    restart: () => {
      generation += 1;
      counts.restarts += 1;
      for (const [id, entry] of entries) {
        disarm(entry);
        entry.generation = generation;
        arm(id, entry);
      }
    },
    pending: () => entries.size,
    stats: () => ({ ...counts }),
  };
}
