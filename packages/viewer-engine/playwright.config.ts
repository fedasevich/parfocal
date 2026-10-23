import { defineConfig } from "@playwright/test";
import { SWIFTSHADER_ARGS } from "../golden-images/src/playwright.ts";

export default defineConfig({
  testDir: "browser",
  globalSetup: "./browser/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  timeout: 60_000,
  reporter: [["list"]],
  use: {
    channel: "chrome",
    headless: true,
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    launchOptions: {
      args: [...SWIFTSHADER_ARGS, "--enable-blink-features=ForceEagerMeasureMemory"],
    },
  },
});
