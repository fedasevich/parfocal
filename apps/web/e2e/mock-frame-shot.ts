import { chromium } from "@playwright/test";

const [base, outDir, ...hashes] = process.argv.slice(2);
if (!base || !outDir || hashes.length === 0) {
  console.error("Usage: node e2e/mock-frame-shot.ts MOCK_URL OUT_DIR HASH...");
  process.exit(1);
}
const browser = await chromium.launch({ channel: "chrome" });
const context = await browser.newContext({
  deviceScaleFactor: 0.5,
  colorScheme: "light",
  viewport: { width: 1600, height: 1000 },
});
for (const hash of hashes) {
  const page = await context.newPage();
  await page.goto(`${base}#${hash}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  const path = `${outDir}/mock-${hash}.png`;
  await page.locator("#app").screenshot({ path });
  console.log(path);
  await page.close();
}
await browser.close();
