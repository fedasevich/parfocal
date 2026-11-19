import { defineConfig } from "@playwright/test";

const port = Number(process.env["PARFOCAL_E2E_PORT"] ?? 5183);
const vite = "node --no-turbo-fast-api-calls ./node_modules/vite/bin/vite.js";
const devServer = `${vite} --port ${port} --strictPort`;
const budgetsApart = process.env["PARFOCAL_BUDGETS_APART"] === "1";
const builtApp = `${vite} build --mode e2e && ${vite} preview --mode e2e --port ${port} --strictPort`;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  expect: { timeout: 15_000 },
  grepInvert: budgetsApart ? /@quarantine|@budget/ : /@quarantine/,
  reporter: process.env.CI
    ? [["list"], ["json", { outputFile: "test-results/report.json" }]]
    : [["list"]],
  use: {
    baseURL: `http://localhost:${port}`,
    channel: "chrome",
    headless: true,
    timezoneId: "Europe/Prague",
    locale: "en-GB",
    trace: process.env.CI ? "off" : "retain-on-failure",
  },
  webServer: {
    command: process.env["PARFOCAL_E2E_SERVER"] === "dev" ? devServer : builtApp,
    env: {
      PARFOCAL_PUBLIC_APP_ENV: "dev",
      PARFOCAL_PUBLIC_FAKE_API: "all",
      PARFOCAL_PUBLIC_DEV_TOOLS: "on",
      PARFOCAL_PUBLIC_API_BASE_URL: "http://127.0.0.1:9161/e2e",
    },
    url: `http://localhost:${port}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
  },
});
