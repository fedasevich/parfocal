import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "hover-bench",
  testMatch: "*.spec.ts",
  globalSetup: "./hover-bench/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env["CI"]),
  timeout: 600_000,
  reporter: [["list"]],
  use: {
    channel: "chrome",
    headless: true,
    launchOptions: { args: ["--enable-unsafe-webgpu"] },
  },
});
