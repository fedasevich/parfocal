import assert from "node:assert/strict";
import { test } from "node:test";
import { slideNoticeOrder, slideNoticesOf } from "../src/viewer/slide-notices.ts";

const calm = {
  remoteOffline: false,
  noResult: false,
  resultSets: null,
  micronsPerPixel: 0.25,
};

test("a slide with nothing to say shows no notice", () => {
  assert.deepEqual(slideNoticesOf(calm), []);
  assert.deepEqual(slideNoticesOf({ ...calm, micronsPerPixel: undefined }), []);
});

test("every slide kind notice comes in one fixed order", () => {
  assert.deepEqual(
    slideNoticesOf({
      remoteOffline: true,
      noResult: true,
      resultSets: { importing: ["Lymph v2"], failed: ["Lymph v1"] },
      micronsPerPixel: null,
    }),
    slideNoticeOrder,
  );
  assert.deepEqual(
    slideNoticesOf({
      ...calm,
      micronsPerPixel: null,
      resultSets: { importing: ["Lymph v2"], failed: [] },
    }),
    ["result-importing", "no-pixel-size"],
  );
  assert.deepEqual(slideNoticesOf({ ...calm, noResult: true, remoteOffline: true }), [
    "remote-offline",
    "no-result",
  ]);
});
