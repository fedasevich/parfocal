export interface RestGate {
  readonly whenRested: () => Promise<void>;
}

export interface RegionPassOptions {
  readonly regions: number;
  readonly sliceMs: number;
  readonly now: () => number;
  readonly yieldToMain: () => Promise<void>;
  readonly gate?: RestGate | undefined;
  readonly spin?: ((ms: number) => void) | undefined;
}

export interface RegionPass {
  readonly completed: () => number;
  readonly waits: () => number;
  readonly finished: Promise<number>;
  readonly stop: () => void;
}

export function spinFor(ms: number, now: () => number): void {
  const until = now() + ms;
  while (now() < until) {}
}

export function startRegionPass(options: RegionPassOptions): RegionPass {
  const spin = options.spin ?? ((ms: number) => spinFor(ms, options.now));
  let completed = 0;
  let waits = 0;
  let stopped = false;

  const run = async (): Promise<number> => {
    while (!stopped && completed < options.regions) {
      if (options.gate) {
        waits += 1;
        await options.gate.whenRested();
      }
      if (stopped) break;
      spin(options.sliceMs);
      completed += 1;
      await options.yieldToMain();
    }
    return completed;
  };

  return {
    completed: () => completed,
    waits: () => waits,
    finished: run(),
    stop: () => {
      stopped = true;
    },
  };
}
