export const REBUILD_EVERY_MS = 3000;
export const REBUILD_SHARE = 0.05;

export interface RebuildGateOptions {
  readonly everyMs?: number;
  readonly share?: number;
  readonly now?: () => number;
}

export class RebuildGate {
  private readonly everyMs: number;
  private readonly share: number;
  private readonly now: () => number;
  private last = Number.NEGATIVE_INFINITY;
  private lastCost = 0;
  private spent = 0;
  private builds = 0;

  constructor(options: RebuildGateOptions = {}) {
    this.everyMs = options.everyMs ?? REBUILD_EVERY_MS;
    this.share = options.share ?? REBUILD_SHARE;
    this.now = options.now ?? (() => performance.now());
  }

  get rebuilds(): number {
    return this.builds;
  }

  get spentMs(): number {
    return this.spent;
  }

  waitMs(): number {
    const gap = Math.max(this.everyMs, this.lastCost / this.share);
    return Math.max(0, this.last + gap - this.now());
  }

  due(): boolean {
    return this.waitMs() === 0;
  }

  run<T>(build: () => T): T {
    const started = this.now();
    const built = build();
    const finished = this.now();
    this.lastCost = finished - started;
    this.spent += this.lastCost;
    this.last = finished;
    this.builds++;
    return built;
  }
}
