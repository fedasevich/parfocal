import { defineConfig } from "@playwright/test";
import type { NetworkOptions } from "./perf/network.ts";
import { RTT_MATRIX_MS } from "./src/proxy.ts";

export default defineConfig<NetworkOptions>({
  testDir: "perf",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  timeout: 30_000,
  reporter: [["list"]],
  use: {
    channel: "chrome",
    headless: true,
  },
  projects: RTT_MATRIX_MS.map((rttMs) => ({ name: `rtt-${rttMs}`, use: { rttMs } })),
});
