import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "j2k-bench",
  testMatch: "*.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 1_800_000,
  reporter: [["list"]],
  use: {
    channel: "chrome",
    headless: process.env["J2K_BENCH_HEADLESS"] === "1",
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    launchOptions: {
      args: [
        "--ignore-gpu-blocklist",
        "--enable-gpu-rasterization",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
        "--disable-background-timer-throttling",
      ],
    },
  },
});
