import { defineConfig, devices } from "@playwright/test";
import { SWIFTSHADER_ARGS } from "../golden-images/src/playwright.ts";
import base from "./playwright.config.ts";

const viewport = { width: 1280, height: 720 };

const FIREFOX_SOFTWARE_WEBGL_PREFS = {
  "webgl.force-enabled": true,
  "webgl.disabled": false,
  "webgl.enable-webgl2": true,
  "webgl.disable-fail-if-major-performance-caveat": true,
};

export default defineConfig({
  ...base,
  use: { headless: true },
  testMatch: "cross-browser.spec.ts",
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [["list"], ["json", { outputFile: "test-results/browser-matrix.json" }]]
    : [["list"]],
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        channel: "chrome",
        viewport,
        deviceScaleFactor: 1,
        launchOptions: { args: [...SWIFTSHADER_ARGS] },
      },
    },
    {
      name: "firefox",
      use: {
        ...devices["Desktop Firefox"],
        viewport,
        deviceScaleFactor: 1,
        launchOptions: { firefoxUserPrefs: FIREFOX_SOFTWARE_WEBGL_PREFS },
      },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"], viewport, deviceScaleFactor: 1 },
    },
  ],
});
