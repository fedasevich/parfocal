import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const roots = ["../src", "../../../apps/web/src"].map(
  (path) => new URL(path, import.meta.url).pathname,
);

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.(tsx?|css)$/.test(entry.name) && !/\.test\./.test(entry.name) ? [path] : [];
  });

const fixed =
  /\b(duration|delay)-(\d+|\[[^\]]+\])(?![\w-])|(transition|animation)(-duration|-delay)?:[^;]*\d+m?s\b/g;

test("no component in packages/ui or apps/web uses a fixed transition duration", () => {
  const found = roots
    .flatMap(sources)
    .flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(fixed)].map((match) => `${file}: ${match[0]}`),
    );
  assert.deepEqual(found, []);
});
