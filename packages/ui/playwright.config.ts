import { defineConfig } from "@playwright/test";

const port = Number(process.env["PARFOCAL_E2E_PORT"] ?? 6007);

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  grepInvert: /@quarantine/,
  reporter: process.env.CI
    ? [["list"], ["json", { outputFile: "test-results/report.json" }]]
    : [["list"]],
  use: {
    baseURL: `http://localhost:${port}`,
    channel: "chrome",
    headless: true,
    trace: process.env.CI ? "off" : "retain-on-failure",
  },
  webServer: {
    command: `vite preview --outDir storybook-static --port ${port} --strictPort`,
    url: `http://localhost:${port}/iframe.html`,
    reuseExistingServer: !process.env.CI,
  },
});
