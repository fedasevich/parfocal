import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createLabelOverlay,
  defaultLabelMetrics,
  type LabelAnchor,
  labelBoxSize,
  labelsOverlap,
  overlayOrder,
  placedLabelBox,
  placeLabels,
  withOverlayState,
} from "../../src/index.ts";

const red = [255, 0, 0, 255] as const;

function anchorAt(id: string, x: number, y: number): LabelAnchor {
  return { id, text: id, x, y, color: red };
}

const crowd: LabelAnchor[] = [
  anchorAt("T1", 200, 150),
  anchorAt("T2", 208, 156),
  anchorAt("T3", 214, 148),
  anchorAt("C101", 204, 162),
  anchorAt("C102", 220, 158),
  anchorAt("C3021", 196, 142),
  anchorAt("R1", 60, 40),
  anchorAt("M1", 340, 260),
];

const view = { x: 0, y: 0, width: 400, height: 300 };

test("a label box is as wide as its text plus padding", () => {
  const short = labelBoxSize("T2");
  const long = labelBoxSize("C3021");
  assert.ok(long.widthPx > short.widthPx);
  assert.equal(
    short.heightPx,
    defaultLabelMetrics.textHeightPx + 2 * defaultLabelMetrics.paddingYPx,
  );
});

test("no two placed labels overlap, at any zoom", () => {
  for (const slidePerScreen of [0.5, 1, 2, 4]) {
    const { placed } = placeLabels(crowd, { slidePerScreen, view });
    const boxes = placed.map((label) => placedLabelBox(label, slidePerScreen, view));
    for (let one = 0; one < boxes.length; one++) {
      for (let two = one + 1; two < boxes.length; two++) {
        const a = boxes[one];
        const b = boxes[two];
        assert.ok(a && b);
        assert.equal(labelsOverlap(a, b), false, `${placed[one]?.id} and ${placed[two]?.id}`);
      }
    }
  }
});

test("a label never covers another object's anchor", () => {
  const { placed } = placeLabels(crowd, { slidePerScreen: 1, view });
  for (const label of placed) {
    const box = placedLabelBox(label, 1, view);
    for (const anchor of crowd) {
      const inside =
        anchor.x > box.left && anchor.x < box.right && anchor.y > box.top && anchor.y < box.bottom;
      assert.equal(inside, false, `${label.id} covers ${anchor.id}`);
    }
  }
});

test("a lone anchor gets the label above and to the right", () => {
  const { placed, hidden } = placeLabels([anchorAt("T1", 100, 100)], { slidePerScreen: 1, view });
  assert.deepEqual(hidden, []);
  const [label] = placed;
  assert.ok(label);
  assert.ok(label.offsetX > 0);
  assert.ok(label.offsetY < 0);
});

test("every anchor is either placed or reported hidden, and placing is repeatable", () => {
  const first = placeLabels(crowd, { slidePerScreen: 4, view });
  const second = placeLabels(crowd, { slidePerScreen: 4, view });
  assert.deepEqual(second, first);
  assert.equal(first.placed.length + first.hidden.length, crowd.length);
});

test("a tight crowd hides what cannot fit instead of overlapping", () => {
  const packed = Array.from({ length: 60 }, (_, index) =>
    anchorAt(`C${index}`, 100 + (index % 10), 100 + Math.floor(index / 10)),
  );
  const { placed, hidden } = placeLabels(packed, { slidePerScreen: 1, view });
  assert.ok(hidden.length > 0);
  assert.equal(placed.length + hidden.length, packed.length);
});

test("the labels named first are placed first and survive a crowd", () => {
  const packed = Array.from({ length: 40 }, (_, index) =>
    anchorAt(`C${index}`, 100 + (index % 8), 100 + Math.floor(index / 8)),
  );
  const { placed } = placeLabels(packed, { slidePerScreen: 1, view, first: ["C39"] });
  assert.equal(placed[0]?.id, "C39");
});

test("anchors outside the view get no label", () => {
  const { placed, hidden } = placeLabels([anchorAt("T1", 100, 100), anchorAt("T2", 900, 900)], {
    slidePerScreen: 1,
    view,
  });
  assert.deepEqual(
    placed.map((label) => label.id),
    ["T1"],
  );
  assert.deepEqual(hidden, []);
});

test("a label stays inside the view", () => {
  const { placed } = placeLabels([anchorAt("T1", 396, 4)], { slidePerScreen: 1, view });
  const [label] = placed;
  assert.ok(label);
  const box = placedLabelBox(label, 1, view);
  assert.ok(box.left >= 0 && box.top >= 0 && box.right <= 400 && box.bottom <= 300);
});

test("the label overlay sits above measurements and below comment pins, and hides like any layer", () => {
  const { placed } = placeLabels(crowd, { slidePerScreen: 1, view });
  const overlay = createLabelOverlay({ id: "id-labels", placed });
  assert.equal(overlay.labels.count, placed.length);
  assert.deepEqual(
    overlay.labels.texts,
    placed.map((label) => label.text),
  );
  assert.ok(overlay.order > overlayOrder("measurements"));
  assert.ok(overlay.order < overlayOrder("comment-pins"));
  assert.equal(withOverlayState(overlay, { visible: false }).visible, false);
});
