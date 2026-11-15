import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "smoke",
  testMatch: "*.spec.ts",
  outputDir: "test-results/smoke",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env["CI"]),
  retries: process.env["CI"] ? 1 : 0,
  timeout: 120_000,
  expect: { timeout: 30_000 },
  reporter: [["list"]],
  use: {
    baseURL: process.env["PARFOCAL_SMOKE_URL"] ?? "https://app.parfocal.eu",
    channel: "chrome",
    headless: true,
    locale: "en-GB",
    screenshot: "on",
    trace: "retain-on-failure",
  },
});
