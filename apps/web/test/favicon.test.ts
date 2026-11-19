import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

const web = new URL("../", import.meta.url).pathname;
const page = readFileSync(`${web}index.html`, "utf8");

const icons = [
  ['rel="icon" href="/favicon.svg"', "public/favicon.svg"],
  ['rel="icon" href="/favicon-32.png"', "public/favicon-32.png"],
  ['rel="apple-touch-icon" href="/apple-touch-icon.png"', "public/apple-touch-icon.png"],
] as const;

for (const [link, file] of icons) {
  test(`the page links ${file} and the file ships`, () => {
    assert.ok(page.includes(link), `index.html lacks ${link}`);
    assert.ok(existsSync(`${web}${file}`), `${file} is missing`);
  });
}

test("the svg favicon draws the Parfocal mark", () => {
  const svg = readFileSync(`${web}public/favicon.svg`, "utf8");
  assert.ok(svg.includes("M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5"));
});
