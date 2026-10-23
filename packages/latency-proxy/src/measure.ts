export interface LatencySample {
  readonly directMs: number;
  readonly proxiedMs: number;
  readonly addedMs: number;
  readonly addedMinMs: number;
  readonly addedMaxMs: number;
  readonly directMinMs: number;
  readonly proxiedMinMs: number;
}

async function timeRequest(url: string): Promise<number> {
  const started = performance.now();
  const response = await fetch(url, { cache: "no-store" });
  await response.arrayBuffer();
  if (!response.ok) {
    throw new Error(`${url} answered ${response.status}`);
  }
  return performance.now() - started;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

export async function measureAddedLatency(
  directUrl: string,
  proxiedUrl: string,
  samples: number,
): Promise<LatencySample> {
  await timeRequest(directUrl);
  await timeRequest(proxiedUrl);
  const direct: number[] = [];
  const proxied: number[] = [];
  for (let index = 0; index < samples; index++) {
    direct.push(await timeRequest(directUrl));
    proxied.push(await timeRequest(proxiedUrl));
  }
  const directMs = median(direct);
  const added = proxied.map((value) => value - directMs);
  return {
    directMs,
    proxiedMs: median(proxied),
    addedMs: median(proxied) - directMs,
    addedMinMs: Math.min(...added),
    addedMaxMs: Math.max(...added),
    directMinMs: Math.min(...direct),
    proxiedMinMs: Math.min(...proxied),
  };
}

export function latencyToleranceMs(expectedMs: number): number {
  return Math.max(10, expectedMs * 0.1);
}
