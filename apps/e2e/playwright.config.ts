import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

const root = fileURLToPath(new URL("../..", import.meta.url));
for (const envFile of [`${root}.zitadel/e2e.env`, `${root}.env`]) {
  if (existsSync(envFile)) {
    process.loadEnvFile(envFile);
  }
}

const ownPorts = process.env["PARFOCAL_E2E_PORT"] !== undefined;
const webPort = Number(process.env["PARFOCAL_E2E_PORT"] ?? 5173);
const apiPort = Number(process.env["PARFOCAL_E2E_API_PORT"] ?? (ownPorts ? webPort + 2000 : 8000));
const origin = `http://localhost:${webPort}`;

const issuer = new URL(process.env["ZITADEL_ISSUER"] ?? "http://missing.invalid");
if (issuer.hostname !== "localhost") {
  throw new Error("ZITADEL_ISSUER must be the local Zitadel. Run infra/local/zitadel-up.sh first.");
}

process.env.EMAIL_BACKEND = "file";
process.env.EMAIL_OUTBOX = `${root}.outbox/e2e-email.jsonl`;
process.env.TILE_TOKEN_KEY ||= randomBytes(32).toString("base64");
process.env.PUBLIC_ORIGIN = origin;
process.env.PARFOCAL_API_PORT = String(apiPort);

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
    trace: process.env.CI ? "off" : "retain-on-failure",
  },
  webServer: [
    {
      command: `uv run --package parfocal-api uvicorn parfocal_api.app:create_app --factory --port ${apiPort}`,
      cwd: root,
      url: `http://localhost:${apiPort}/api/health`,
      reuseExistingServer: !ownPorts,
    },
    {
      command: `pnpm --filter @parfocal/web dev --port ${webPort} --strictPort`,
      cwd: root,
      url: `${origin}/`,
      reuseExistingServer: !ownPorts,
    },
  ],
});
