import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatMicrons, formatSquareMicrons } from "../src/measure/length-units.ts";
import { formatRulerLength } from "../src/measure/ruler-maths.ts";

describe("length units setting", () => {
  it("auto switches to mm from 1000 µm", () => {
    assert.equal(formatMicrons(42.04, "auto"), "42.0 µm");
    assert.equal(formatMicrons(640, "auto"), "640 µm");
    assert.equal(formatMicrons(2500, "auto"), "2.50 mm");
  });

  it("always µm never switches to mm", () => {
    assert.equal(formatMicrons(42.04, "um"), "42.0 µm");
    assert.equal(formatMicrons(640, "um"), "640 µm");
    assert.equal(formatMicrons(2500, "um"), "2500 µm");
  });

  it("applies to areas", () => {
    assert.equal(formatSquareMicrons(2_500_000, "auto"), "2.50 mm²");
    assert.equal(formatSquareMicrons(2_500_000, "um"), "2 500 000 µm²");
    assert.equal(formatSquareMicrons(50, "um"), "50.0 µm²");
  });

  it("applies to the ruler label", () => {
    const segment = { from: { x: 0, y: 0 }, to: { x: 4000, y: 0 } };
    assert.equal(formatRulerLength(segment, 0.5, "auto"), "2.00 mm");
    assert.equal(formatRulerLength(segment, 0.5, "um"), "2000 µm");
    assert.equal(formatRulerLength(segment, null, "um"), "4000 px");
  });
});
