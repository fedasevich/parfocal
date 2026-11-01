import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { colorTokens, radiiPx, spaceUnitPx } from "../src/index.ts";

const css = readFileSync(new URL("../src/tokens.css", import.meta.url), "utf8");
const theme = readFileSync(new URL("../src/theme.css", import.meta.url), "utf8");

function block(selector: string): Map<string, string> {
  const start = css.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `missing ${selector}`);
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
  const entries = [...body.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)];
  return new Map(entries.map((match) => [match[1] ?? "", (match[2] ?? "").trim()]));
}

const dark = block('[data-theme="dark"]');
const light = block('[data-theme="light"]');
const shared = block(":root");

test("every colour token has a dark and a light value", () => {
  for (const token of colorTokens) {
    assert.ok(dark.get(token), `${token} has no dark value`);
    assert.ok(light.get(token), `${token} has no light value`);
  }
});

test("each theme block holds only the colour tokens", () => {
  assert.deepEqual([...dark.keys()].sort(), [...colorTokens].sort());
  assert.deepEqual([...light.keys()].sort(), [...colorTokens].sort());
});

test("unsure keeps the kit values", () => {
  assert.equal(dark.get("unsure"), "#cbd5e1");
  assert.equal(light.get("unsure"), "#475569");
});

test("spacing and radii match the constants", () => {
  assert.equal(shared.get("space"), `${spaceUnitPx}px`);
  assert.equal(shared.get("r-sm"), `${radiiPx.sm}px`);
  assert.equal(shared.get("r-md"), `${radiiPx.md}px`);
  assert.equal(shared.get("r-lg"), `${radiiPx.lg}px`);
});

test("the Tailwind theme exposes every colour token", () => {
  for (const token of colorTokens) {
    assert.ok(
      theme.includes(`--color-${token}: var(--${token});`),
      `--color-${token} is not mapped`,
    );
  }
});
