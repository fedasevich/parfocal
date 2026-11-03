import assert from "node:assert/strict";
import { test } from "node:test";
import { chromeBudget, chromeWidths, coveredShare } from "../e2e/chrome-share.ts";

test("no chrome covers nothing", () => {
  assert.equal(coveredShare([], 1440, 900), 0);
});

test("a top bar and a side panel add up when they do not overlap", () => {
  const share = coveredShare(
    [
      { x: 0, y: 0, width: 1000, height: 100 },
      { x: 600, y: 100, width: 400, height: 900 },
    ],
    1000,
    1000,
  );
  assert.equal(share, 0.46);
});

test("overlapping and nested parts count once", () => {
  const share = coveredShare(
    [
      { x: 0, y: 0, width: 500, height: 500 },
      { x: 250, y: 250, width: 500, height: 500 },
      { x: 10, y: 10, width: 20, height: 20 },
    ],
    1000,
    1000,
  );
  assert.equal(share, 0.4375);
});

test("parts outside the viewport or with no size are clipped away", () => {
  const share = coveredShare(
    [
      { x: -100, y: 0, width: 200, height: 1000 },
      { x: 900, y: 900, width: 500, height: 500 },
      { x: 300, y: 300, width: 0, height: 400 },
      { x: 2000, y: 0, width: 100, height: 100 },
    ],
    1000,
    1000,
  );
  assert.equal(share, 0.11);
});

test("the whole viewport covered is a share of one", () => {
  assert.equal(coveredShare([{ x: -5, y: -5, width: 2000, height: 2000 }], 1440, 900), 1);
  assert.equal(coveredShare([{ x: 0, y: 0, width: 10, height: 10 }], 0, 900), 0);
});

test("the KPI budget and the measured widths match the backlog", () => {
  assert.equal(chromeBudget, 0.35);
  assert.deepEqual([...chromeWidths], [1280, 1440, 1920]);
});
