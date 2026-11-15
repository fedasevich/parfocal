import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "browser",
  testMatch: "nuclei-stream.spec.ts",
  globalSetup: "./browser/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  reporter: [["list"]],
  use: {
    channel: "chrome",
    headless: false,
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    launchOptions: { args: ["--ignore-gpu-blocklist", "--enable-gpu-rasterization"] },
  },
});
