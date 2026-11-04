import { readFileSync } from "node:fs";
import { expect, exportTelemetry, seededNamesIn, test } from "./telemetry-capture.ts";

const p03 = "00000000-0000-4000-8003-000000000003";

test("a clinical slide shows its seeded patient while the URL and telemetry hold only ids", async ({
  page,
  telemetry,
}) => {
  await page.goto(`/projects/${p03}?tab=slides`);
  await page.getByTestId("slide-row").first().click();
  const banner = page.getByTestId("patient-banner");
  await expect(banner).toBeVisible({ timeout: 15_000 });
  expect(seededNamesIn((await banner.textContent()) ?? "")).not.toEqual([]);
  const path = new URL(page.url()).pathname;
  expect(path).toMatch(/^\/projects\/[0-9a-f-]{36}\/slides\/[\w-]+(?:\/[\w-]+)?$/u);
  expect(seededNamesIn(path)).toEqual([]);
  expect(readFileSync(telemetry, "utf8")).toContain(`"navigation"`);
});

test("the scan catches a seeded name that reaches the console", async ({ browser }, testInfo) => {
  const page = await browser.newPage();
  const file = testInfo.outputPath("leaky-telemetry.jsonl");
  exportTelemetry(page, file);
  await page.goto("/sign-in");
  await page.evaluate(() => console.error("Opened Fake Patient 3, record FAKE-0003"));
  await expect
    .poll(() => seededNamesIn(readFileSync(file, "utf8")))
    .toEqual(["Fake Patient", "FAKE-0003"]);
  await page.close();
});
