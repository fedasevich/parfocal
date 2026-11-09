import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "region-bench",
  testMatch: "*.spec.ts",
  globalSetup: "./region-bench/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env["CI"]),
  timeout: 600_000,
  grepInvert: /@quarantine/,
  reporter: process.env.CI
    ? [["list"], ["json", { outputFile: "test-results/report.json" }]]
    : [["list"]],
  use: {
    channel: "chrome",
    headless: true,
    launchOptions: { args: ["--enable-unsafe-webgpu"] },
  },
});
