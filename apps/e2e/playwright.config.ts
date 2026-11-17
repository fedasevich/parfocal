import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

const root = fileURLToPath(new URL("../..", import.meta.url));
const zitadelSettings = `${root}.zitadel/e2e.env`;
if (existsSync(zitadelSettings)) {
  process.loadEnvFile(zitadelSettings);
}

const ownPorts = process.env["PARFOCAL_E2E_PORT"] !== undefined;
const webPort = Number(process.env["PARFOCAL_E2E_PORT"] ?? 5173);
const apiPort = Number(process.env["PARFOCAL_E2E_API_PORT"] ?? (ownPorts ? webPort + 2000 : 8000));
const origin = `http://localhost:${webPort}`;

const issuer = new URL(process.env["ZITADEL_ISSUER"] ?? "http://missing.invalid");
if (issuer.hostname !== "localhost") {
  throw new Error("ZITADEL_ISSUER must be the local Zitadel. Run pnpm stack:up first.");
}

process.env.EMAIL_OUTBOX = `${root}.outbox/e2e-email.jsonl`;
process.env.PARFOCAL_API_PORT = String(apiPort);
process.env.PARFOCAL_PUBLIC_APP_ENV ||= "test";

export default defineConfig({
  testDir: "tests",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  grepInvert: /@quarantine/,
  globalSetup: "./global-setup.ts",
  reporter: process.env.CI
    ? [["list"], ["json", { outputFile: "test-results/report.json" }]]
    : [["list"]],
  use: {
    baseURL: origin,
    channel: "chrome",
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `pnpm --filter @parfocal/web dev --port ${webPort} --strictPort`,
    cwd: root,
    url: `${origin}/`,
    reuseExistingServer: !ownPorts,
  },
});
