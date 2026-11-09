import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build, type PreviewServer, preview } from "vite";
import { expect, test } from "./a11y.ts";

const port = Number(process.env["PARFOCAL_E2E_PORT"] ?? 5183) + 1;
const delayMs = 120;

let outDir = "";
let server: PreviewServer | undefined;

test.beforeAll(async () => {
  test.setTimeout(240_000);
  outDir = mkdtempSync(join(tmpdir(), "parfocal-font-preload-"));
  process.env["PARFOCAL_PUBLIC_APP_ENV"] = "dev";
  await build({ logLevel: "silent", build: { outDir, emptyOutDir: true } });
  server = await preview({
    logLevel: "silent",
    build: { outDir },
    preview: { port, strictPort: true, host: "127.0.0.1" },
  });
});

test.afterAll(async () => {
  await server?.close();
  if (outDir !== "") rmSync(outDir, { recursive: true, force: true });
});

test("a throttled first load renders Plex from files the build contains", async ({ page }) => {
  const fontRequests: string[] = [];
  await page.route(/\.woff2(\?.*)?$/, async (route) => {
    fontRequests.push(new URL(route.request().url()).pathname);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    await route.continue();
  });
  const origin = `http://127.0.0.1:${port}`;
  await page.goto(`${origin}/`);
  await page.waitForLoadState("load");

  const hrefs = await page
    .locator('link[rel="preload"][as="font"]')
    .evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? ""));
  expect(hrefs).toHaveLength(2);
  expect(hrefs.some((href) => href.includes("ibm-plex-sans-latin-400-normal"))).toBe(true);
  expect(hrefs.some((href) => href.includes("ibm-plex-sans-latin-600-normal"))).toBe(true);
  for (const href of hrefs) {
    const response = await page.request.get(new URL(href, origin).href);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("font/woff2");
  }

  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.fonts.check('400 16px "IBM Plex Sans"') &&
          document.fonts.check('600 16px "IBM Plex Sans"'),
      ),
    )
    .toBe(true);
  const loaded = await page.evaluate(() =>
    [...document.fonts]
      .filter((face) => face.status === "loaded")
      .map((face) => `${face.family} ${face.weight}`),
  );
  expect(loaded.some((name) => name.includes("IBM Plex Sans") && name.endsWith("400"))).toBe(true);
  expect(loaded.some((name) => name.includes("IBM Plex Sans") && name.endsWith("600"))).toBe(true);

  for (const href of hrefs) {
    const path = new URL(href, origin).pathname;
    expect(fontRequests.filter((request) => request === path)).toHaveLength(1);
  }
});
