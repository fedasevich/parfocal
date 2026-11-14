import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("../src/components/loader.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/styles/globals.css", import.meta.url), "utf8");

test("the loader is a status with a label for screen readers", () => {
  assert.match(source, /role="status"/);
  assert.match(source, /<span className="sr-only">\{label\}<\/span>/);
});

test("the loader has inline, block and page sizes", () => {
  assert.match(source, /"inline" \| "block" \| "page"/);
});

test("the one animation has keyframes and is switched off for reduced motion", () => {
  assert.match(css, /@keyframes pf-breathe\b/);
  assert.match(source, /animationName: "pf-breathe"/);
  assert.match(source, /motion-reduce:\[animation:none\]/);
});

test("the old proposal keyframes are gone", () => {
  for (const name of ["pf-spin", "pf-sweep", "pf-wave", "pf-tick"]) {
    assert.doesNotMatch(css, new RegExp(`@keyframes ${name}\\b`));
  }
});

test("the loader adds no dependency", () => {
  const imports = [...source.matchAll(/from "([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(imports, ["@parfocal/ui/lib/utils"]);
});
