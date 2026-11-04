import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { type LayoutBlock, type LayoutFormat, type LayoutPage, reportPages } from "../src/index.ts";

type LayoutCase = {
  name: string;
  format: LayoutFormat;
  blocks: LayoutBlock[];
  pages: LayoutPage[];
};

const cases = (
  JSON.parse(
    readFileSync(new URL("../../test-fixtures/report-layout.json", import.meta.url), "utf8"),
  ) as { cases: LayoutCase[] }
).cases;

for (const layout of cases) {
  test(`the page plan matches the PDF layout: ${layout.name}`, () => {
    assert.deepEqual(reportPages(layout.blocks, layout.format), layout.pages);
  });
}

test("the shared layout covers every block kind, half widths and page breaks", () => {
  const blocks = cases.flatMap((layout) => layout.blocks);
  assert.equal(new Set(blocks.map((block) => block.kind)).size, 11);
  assert.ok(blocks.some((block) => block.width === "half"));
  assert.ok(blocks.some((block) => block.page_break));
});
