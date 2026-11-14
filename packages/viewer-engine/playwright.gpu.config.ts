import { defineConfig } from "@playwright/test";

const viewport = {
  width: Number(process.env["GPU_TIMING_WIDTH"] ?? 1440),
  height: Number(process.env["GPU_TIMING_HEIGHT"] ?? 900),
};

export default defineConfig({
  testDir: "gpu-bench",
  testMatch: "*.spec.ts",
  globalSetup: "./gpu-bench/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 600_000,
  reporter: [["list"]],
  use: {
    channel: "chrome",
    headless: process.env["GPU_TIMING_HEADLESS"] === "1",
    viewport,
    deviceScaleFactor: Number(process.env["GPU_TIMING_DPR"] ?? 2),
    launchOptions: { args: ["--ignore-gpu-blocklist", "--enable-gpu-rasterization"] },
  },
});
