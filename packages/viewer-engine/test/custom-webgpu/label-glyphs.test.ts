import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildLabelInstances,
  glyphAtlasWidth,
  glyphCharacters,
  layoutGlyphs,
} from "../../src/custom-webgpu/label-glyphs.ts";
import { glyphInstanceBytes, labelBoxInstanceBytes } from "../../src/custom-webgpu/protocol.ts";

const measure = (character: string) =>
  character === " "
    ? { advance: 40, width: 0, ascent: 0, descent: 0 }
    : { advance: 40, width: 30, ascent: 48, descent: 16 };

const layout = layoutGlyphs(glyphCharacters(), measure, { ascent: 60, descent: 20 });

describe("label glyph layout", () => {
  it("packs the 96 characters deck.gl draws in rows with a 4 pixel buffer", () => {
    assert.equal(layout.frames.size, 96);
    assert.deepEqual(layout.frames.get(" "), {
      x: 4,
      y: 4,
      width: 0,
      height: 0,
      advance: 40,
      ascent: 0,
    });
    assert.equal(layout.frames.get("!")?.x, 12);
    for (const frame of layout.frames.values()) {
      assert.ok(frame.x + frame.width + 4 <= glyphAtlasWidth);
    }
    assert.equal(layout.baselineOffset, 20);
    assert.equal(layout.height, 512);
    assert.ok([...layout.frames.values()].some((frame) => frame.y === 76));
  });

  it("places one box per label and one glyph per drawn character at the font scale", () => {
    const { boxes, boxCount, glyphs, glyphCount } = buildLabelInstances(
      {
        count: 1,
        positions: new Float32Array([100, 200]),
        offsets: new Float32Array([8, -26]),
        sizes: new Float32Array([0, 0]),
        colors: new Uint8Array([10, 20, 30, 255]),
        texts: ["A 1"],
      },
      layout,
    );
    assert.equal(boxCount, 1);
    assert.equal(boxes.byteLength, labelBoxInstanceBytes);
    assert.deepEqual([...new Float32Array(boxes, 0, 6)], [100, 200, 8, -26, 22.5 + 12, 12 + 6]);
    assert.deepEqual([...new Uint8Array(boxes, 24, 4)], [10, 20, 30, 255]);
    assert.equal(glyphCount, 2);
    assert.equal(glyphs.byteLength, 2 * glyphInstanceBytes);
    const [first, second] = [new Float32Array(glyphs, 0, 10), new Float32Array(glyphs, 40, 10)];
    const frame = layout.frames.get("A");
    assert.deepEqual(
      [...first],
      [100, 200, 14, -26 + 3 + 0.75, 5.625, 12, frame?.x, frame?.y, 30, 64],
    );
    assert.equal(second[2], 14 + 15);
  });
});
