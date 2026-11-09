import { appendFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { test as base } from "@playwright/test";
import { isAllowed } from "./a11y-allowlist.ts";

export * from "@playwright/test";

const wcagTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];

const scannedRoutes = new Set<string>();

export function routeOf(address: string): string | null {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return null;
  }
  if (!url.protocol.startsWith("http")) return null;
  const path = url.pathname
    .split("/")
    .map((part) => (/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(part) || /^\d+$/.test(part) ? ":id" : part))
    .join("/");
  const scene = url.searchParams.get("scene");
  return scene === null ? path : `${path}?scene=${scene}`;
}

export const test = base.extend<{ accessible: undefined }>({
  accessible: [
    async ({ page }, use, testInfo) => {
      await use(undefined);
      if (testInfo.status !== testInfo.expectedStatus) return;
      if (testInfo.annotations.some((note) => note.type === "skip-axe")) return;
      if (page.isClosed()) return;
      const route = routeOf(page.url());
      if (route === null || scannedRoutes.has(route)) return;
      scannedRoutes.add(route);
      const results = await new AxeBuilder({ page })
        .withTags(wcagTags)
        .exclude("[data-base-ui-focus-guard]")
        .analyze();
      const found = results.violations.map((violation) => ({
        rule: violation.id,
        targets: violation.nodes.map((node) => node.target.join(" ")).slice(0, 5),
      }));
      const recordFile = process.env["PARFOCAL_A11Y_RECORD"];
      if (recordFile !== undefined && recordFile !== "") {
        for (const violation of found) {
          appendFileSync(recordFile, `${JSON.stringify({ route, ...violation })}\n`);
        }
        return;
      }
      const fresh = found.filter((violation) => !isAllowed(violation.rule, route));
      if (fresh.length > 0) {
        throw new Error(
          `axe found accessibility violations on ${route}:\n${JSON.stringify(fresh, null, 2)}`,
        );
      }
    },
    { auto: true, timeout: 30_000 },
  ],
});
