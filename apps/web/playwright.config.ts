import { defineConfig } from "@playwright/test";

const port = Number(process.env["PARFOCAL_E2E_PORT"] ?? 5183);

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${port}`,
    channel: "chrome",
    headless: true,
    timezoneId: "Europe/Prague",
    locale: "en-GB",
    trace: process.env.CI ? "off" : "retain-on-failure",
  },
  webServer: {
    command: `node --no-turbo-fast-api-calls ./node_modules/vite/bin/vite.js --port ${port} --strictPort`,
    env: {
      PARFOCAL_PUBLIC_APP_ENV: "dev",
      PARFOCAL_PUBLIC_FAKE_API: "all",
      PARFOCAL_PUBLIC_API_BASE_URL: "http://127.0.0.1:9161/e2e",
    },
    url: `http://localhost:${port}/`,
    reuseExistingServer: !process.env.CI,
  },
});
