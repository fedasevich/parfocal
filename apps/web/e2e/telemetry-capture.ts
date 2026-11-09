import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { test as base } from "./a11y.ts";

export { expect } from "./a11y.ts";

export const seededPatientPatterns: readonly RegExp[] = [
  /fake(?:\s|%20|\+|_|-)*patient/giu,
  /fake-\d{4}/giu,
];

export type TelemetryLine = { readonly kind: string; readonly text: string };

export function seededNamesIn(text: string): string[] {
  return seededPatientPatterns.flatMap((pattern) => [...text.matchAll(pattern)].map((m) => m[0]));
}

export function exportTelemetry(page: Page, file: string): void {
  writeFileSync(file, "");
  const write = (line: TelemetryLine) => appendFileSync(file, `${JSON.stringify(line)}\n`);
  page.on("console", (message) =>
    write({ kind: `console.${message.type()}`, text: message.text() }),
  );
  page.on("pageerror", (error) =>
    write({ kind: "pageerror", text: `${error.name}: ${error.message}\n${error.stack ?? ""}` }),
  );
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame())
      write({ kind: "navigation", text: new URL(frame.url()).pathname });
  });
}

export const test = base.extend<{ telemetry: string }>({
  telemetry: [
    async ({ page }, use, testInfo) => {
      const file = testInfo.outputPath("telemetry.jsonl");
      exportTelemetry(page, file);
      await use(file);
      const text = readFileSync(file, "utf8");
      await testInfo.attach("telemetry", { path: file, contentType: "application/jsonl" });
      const leaked = seededNamesIn(text);
      if (leaked.length > 0) {
        throw new Error(`telemetry holds seeded patient data: ${[...new Set(leaked)].join(", ")}`);
      }
    },
    { auto: true },
  ],
});
