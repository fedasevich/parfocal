import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

const root = fileURLToPath(new URL("../..", import.meta.url));
const envFile = `${root}.env`;
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}
process.env.EMAIL_BACKEND = "file";
process.env.EMAIL_OUTBOX = `${root}.outbox/e2e-email.jsonl`;

export default defineConfig({
  testDir: "tests",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5173",
    channel: "chrome",
    headless: true,
    trace: process.env.CI ? "off" : "retain-on-failure",
  },
  webServer: [
    {
      command: "pnpm api:dev",
      cwd: root,
      url: "http://localhost:8000/api/health",
      reuseExistingServer: true,
    },
    {
      command: "pnpm --filter @parfocal/web dev --port 5173 --strictPort",
      cwd: root,
      url: "http://localhost:5173/",
      reuseExistingServer: true,
    },
  ],
});
