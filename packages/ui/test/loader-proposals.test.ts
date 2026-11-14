import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(
  new URL("../src/components/loader-proposals.tsx", import.meta.url),
  "utf8",
);
const css = readFileSync(new URL("../src/styles/globals.css", import.meta.url), "utf8");

test("there are five proposals, each with a status role and a label", () => {
  const ids = [...source.matchAll(/id: "([a-z]+)"/g)].map((match) => match[1]);
  assert.equal(ids.length, 5);
  assert.equal(new Set(ids).size, 5);
  assert.match(source, /role: "status"/);
  assert.match(source, /"aria-label": label/);
});

test("every animation a proposal uses has keyframes in the shared stylesheet", () => {
  const used = new Set([...source.matchAll(/"(pf-[a-z]+)"/g)].map((match) => match[1]));
  assert.equal(used.size, 5);
  for (const name of used) assert.match(css, new RegExp(`@keyframes ${name}\\b`));
});

test("every animated element is switched off for reduced motion", () => {
  const animated = source.match(/motion\(still, "pf-/g)?.length ?? 0;
  const guarded = source.match(/motion-reduce:\[animation:none\]/g)?.length ?? 0;
  assert.equal(animated, 5);
  assert.ok(guarded >= animated);
});

test("the proposals add no dependency", () => {
  const imports = [...source.matchAll(/from "([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(imports, ["@parfocal/ui/lib/utils"]);
});
