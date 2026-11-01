import { defineConfig } from "@playwright/test";

const port = 5183;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${port}`,
    channel: "chrome",
    headless: true,
    trace: process.env.CI ? "off" : "retain-on-failure",
  },
  webServer: {
    command: `vite --port ${port} --strictPort`,
    env: { PARFOCAL_PUBLIC_APP_ENV: "dev", PARFOCAL_PUBLIC_FAKE_API: "all" },
    url: `http://localhost:${port}/`,
    reuseExistingServer: !process.env.CI,
  },
});
