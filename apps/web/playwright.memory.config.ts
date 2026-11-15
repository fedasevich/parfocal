import { defineConfig } from "@playwright/test";
import base from "./playwright.config.ts";

export default defineConfig({
  ...base,
  testDir: "memory",
  testMatch: "*.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 600_000,
  reporter: process.env.CI
    ? [["list"], ["json", { outputFile: "test-results/memory-report.json" }]]
    : [["list"]],
});
