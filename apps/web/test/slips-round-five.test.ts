import assert from "node:assert/strict";
import { test } from "node:test";
import { slidesTimeLeft } from "../src/screens/review/slides-time-left.ts";
import { resultSetName } from "../src/screens/viewer/result-set-name.ts";

test("a result set shows its model version once", () => {
  assert.equal(resultSetName("PathoSAM + HoVer-NeXt", "v1.2"), "PathoSAM + HoVer-NeXt v1.2");
  assert.equal(resultSetName("PathoSAM + HoVer-NeXt v1.2", "v1.2"), "PathoSAM + HoVer-NeXt v1.2");
  assert.equal(resultSetName("Imported cells", null), "Imported cells");
});

test("the top bar time counts the open slide like My work does", () => {
  assert.equal(slidesTimeLeft(2, 3), "about 32 min left");
  assert.equal(slidesTimeLeft(3, 3), "about 16 min left");
  assert.equal(slidesTimeLeft(8, 12), "about 1 h 20 min left");
});
