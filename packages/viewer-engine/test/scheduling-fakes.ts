import type { Cancel, TabVisibility, TaskScheduler, TimerScheduler } from "../src/index.ts";

export class FakeVisibility implements TabVisibility {
  private isHidden = false;
  readonly listeners = new Set<() => void>();

  hidden(): boolean {
    return this.isHidden;
  }

  subscribe(listener: () => void): Cancel {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  set(hidden: boolean): void {
    this.isHidden = hidden;
    for (const listener of [...this.listeners]) listener();
  }

  setQuietly(hidden: boolean): void {
    this.isHidden = hidden;
  }
}

export class FakeTimers implements TimerScheduler {
  private next = 1;
  readonly pending = new Map<number, { callback: () => void; ms: number }>();

  after(callback: () => void, ms: number): Cancel {
    const id = this.next++;
    this.pending.set(id, { callback, ms });
    return () => {
      this.pending.delete(id);
    };
  }

  fire(): void {
    const due = [...this.pending.values()];
    this.pending.clear();
    for (const timer of due) timer.callback();
  }
}

export class FakeTasks implements TaskScheduler {
  private next = 1;
  readonly pending = new Map<number, () => void>();

  run(callback: () => void): Cancel {
    const id = this.next++;
    this.pending.set(id, callback);
    return () => {
      this.pending.delete(id);
    };
  }

  flush(): number {
    let count = 0;
    while (this.pending.size > 0) {
      const callbacks = [...this.pending.values()];
      this.pending.clear();
      for (const callback of callbacks) callback();
      count += callbacks.length;
      if (count > 1000) throw new Error("Tasks keep scheduling tasks");
    }
    return count;
  }
}
