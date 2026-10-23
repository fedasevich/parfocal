import { latencyToleranceMs } from "../src/measure.ts";
import { expect, test } from "./network.ts";

const REQUESTS = 8;
const TILE_BYTES = 64 * 1024;

test("sequential tile requests each pay one RTT", async ({ page, network, rttMs }, testInfo) => {
  await page.goto(`${network.proxy.url}/`);
  network.proxy.resetStats();
  const timings = await page.evaluate(
    async ({ requests, bytes }) => {
      const durations: number[] = [];
      for (let index = 0; index < requests; index++) {
        const started = performance.now();
        const response = await fetch(`/bytes/${bytes}?n=${index}`, { cache: "no-store" });
        await response.arrayBuffer();
        durations.push(performance.now() - started);
      }
      return durations;
    },
    { requests: REQUESTS, bytes: TILE_BYTES },
  );
  const sorted = [...timings].sort((a, b) => a - b);
  const median = ((sorted[REQUESTS / 2 - 1] ?? 0) + (sorted[REQUESTS / 2] ?? 0)) / 2;
  const description = `rtt ${rttMs} ms: median ${median.toFixed(2)} ms, min ${sorted[0]?.toFixed(2)} ms, max ${sorted.at(-1)?.toFixed(2)} ms over ${REQUESTS} requests of ${TILE_BYTES} bytes`;
  testInfo.annotations.push({ type: "perf", description });
  console.log(description);
  expect(network.proxy.stats()).toEqual({ requests: REQUESTS, bytes: REQUESTS * TILE_BYTES });
  const fastest = sorted[0] ?? 0;
  expect(fastest).toBeGreaterThanOrEqual(rttMs - 1);
  expect(fastest).toBeLessThanOrEqual(rttMs + latencyToleranceMs(rttMs));
});

test("twelve parallel requests take two RTTs over six HTTP/1.1 connections", async ({
  page,
  network,
  rttMs,
}, testInfo) => {
  await page.goto(`${network.proxy.url}/`);
  const elapsed = await page.evaluate(async (bytes) => {
    let fastest = Number.POSITIVE_INFINITY;
    for (let round = 0; round < 3; round++) {
      const started = performance.now();
      await Promise.all(
        Array.from({ length: 12 }, (_, index) =>
          fetch(`/bytes/${bytes}?r=${round}&p=${index}`, { cache: "no-store" }).then((response) =>
            response.arrayBuffer(),
          ),
        ),
      );
      fastest = Math.min(fastest, performance.now() - started);
    }
    return fastest;
  }, TILE_BYTES);
  const description = `rtt ${rttMs} ms: 12 parallel requests took ${elapsed.toFixed(2)} ms in the fastest of 3 rounds`;
  testInfo.annotations.push({ type: "perf", description });
  console.log(description);
  expect(elapsed).toBeGreaterThanOrEqual(2 * rttMs - 1);
  expect(elapsed).toBeLessThanOrEqual(2 * rttMs + Math.max(40, rttMs * 0.25));
});
