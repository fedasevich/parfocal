import { test as base } from "@playwright/test";
import { type OriginServer, startOriginServer } from "../src/origin.ts";
import { type LatencyProxy, startLatencyProxy } from "../src/proxy.ts";

export interface NetworkOptions {
  rttMs: number;
  bandwidthBytesPerSecond: number | null;
}

export interface Network {
  origin: OriginServer;
  proxy: LatencyProxy;
}

const PAGE =
  '<!doctype html><html><head><title>perf</title><link rel="icon" href="data:,"></head><body>perf</body></html>';

export const test = base.extend<{ network: Network }, NetworkOptions>({
  rttMs: [0, { option: true, scope: "worker" }],
  bandwidthBytesPerSecond: [null, { option: true, scope: "worker" }],
  network: async ({ rttMs, bandwidthBytesPerSecond }, use) => {
    const origin = await startOriginServer({ "/": { body: PAGE, contentType: "text/html" } });
    const proxy = await startLatencyProxy({ target: origin.url, rttMs, bandwidthBytesPerSecond });
    try {
      await use({ origin, proxy });
    } finally {
      await proxy.close();
      await origin.close();
    }
  },
});

export { expect } from "@playwright/test";
