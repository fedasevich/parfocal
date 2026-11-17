import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";
import { switchedAreas } from "./e2e/real.ts";

const root = fileURLToPath(new URL("../..", import.meta.url));
const zitadelSettings = `${root}.zitadel/e2e.env`;
if (existsSync(zitadelSettings)) {
  process.loadEnvFile(zitadelSettings);
}

const ownPorts = process.env["PARFOCAL_E2E_PORT"] !== undefined;
const webPort = Number(process.env["PARFOCAL_E2E_PORT"] ?? 5173);
const apiPort = Number(process.env["PARFOCAL_E2E_API_PORT"] ?? (ownPorts ? webPort + 2000 : 8000));
const origin = `http://localhost:${webPort}`;

process.env["PARFOCAL_E2E_BACKEND"] = "real";

const areas = switchedAreas.map((tag) => tag.slice(1)).join("|");

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  grep: new RegExp(`^(?=.*@real\\b)(?=.*@(${areas})\\b)`),
  grepInvert: /@quarantine/,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI
    ? [["list"], ["json", { outputFile: "test-results/real-report.json" }]]
    : [["list"]],
  use: {
    baseURL: origin,
    channel: "chrome",
    headless: true,
    timezoneId: "Europe/Prague",
    locale: "en-GB",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `node --no-turbo-fast-api-calls ./node_modules/vite/bin/vite.js --port ${webPort} --strictPort`,
    env: {
      PARFOCAL_PUBLIC_APP_ENV: "test",
      PARFOCAL_PUBLIC_FAKE_API: "off",
      PARFOCAL_API_PORT: String(apiPort),
    },
    url: `${origin}/`,
    reuseExistingServer: false,
    timeout: 300_000,
  },
});
