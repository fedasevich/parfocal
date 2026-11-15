export const tileSli = "sli.tile.fetch";
export const tileThresholdMs = 60;
export const sliBatchPrefix = "ops/sli/batches/";
export const flushAfterMs = 30_000;
const bucketMs = 60_000;

export type SliBatch = Record<string, Record<string, [number, number]>>;

export type SliBucket = {
  put(
    key: string,
    body: string,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
};

export type TileSliCounter = {
  observe(status: number, elapsedMs: number): void;
  due(): boolean;
  drain(): SliBatch | null;
};

export function tileOutcomeCounts(status: number): boolean {
  return status < 400 || status >= 500;
}

export function createTileSliCounter(now: () => number): TileSliCounter {
  let buckets = new Map<number, [number, number]>();
  let firstPending: number | null = null;
  return {
    observe(status, elapsedMs) {
      if (!tileOutcomeCounts(status)) return;
      const at = now();
      const bucket = Math.floor(at / bucketMs) * (bucketMs / 1000);
      const bad = status >= 500 || elapsedMs > tileThresholdMs ? 1 : 0;
      const [total, failed] = buckets.get(bucket) ?? [0, 0];
      buckets.set(bucket, [total + 1, failed + bad]);
      firstPending ??= at;
    },
    due() {
      return firstPending !== null && now() - firstPending >= flushAfterMs;
    },
    drain() {
      if (buckets.size === 0) return null;
      const series = Object.fromEntries(
        [...buckets].map(([bucket, tally]) => [String(bucket), tally]),
      );
      buckets = new Map();
      firstPending = null;
      return { [tileSli]: series };
    },
  };
}

export async function flushTileSli(
  counter: TileSliCounter,
  bucket: SliBucket,
  now: () => number,
  id: () => string = () => crypto.randomUUID(),
): Promise<void> {
  const batch = counter.drain();
  if (batch === null) return;
  const key = `${sliBatchPrefix}${Math.floor(now() / 1000)}-${id()}.json`;
  try {
    await bucket.put(key, JSON.stringify(batch), {
      httpMetadata: { contentType: "application/json" },
    });
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: "sli batch not stored",
        error_type: error instanceof Error ? error.name : typeof error,
      }),
    );
  }
}
