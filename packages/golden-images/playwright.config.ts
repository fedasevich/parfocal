import { defineConfig } from "@playwright/test";
import { SWIFTSHADER_ARGS } from "./src/playwright.ts";

export default defineConfig({
  testDir: "render",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  timeout: 30_000,
  reporter: [["list"]],
  use: {
    channel: "chrome",
    headless: true,
    viewport: { width: 800, height: 600 },
    deviceScaleFactor: 1,
    launchOptions: { args: SWIFTSHADER_ARGS },
  },
});
