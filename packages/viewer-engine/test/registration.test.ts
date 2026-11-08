import assert from "node:assert/strict";
import { test } from "node:test";
import {
  alignWithOffset,
  createLinkedViews,
  type GrayImage,
  moveView,
  registerThumbnails,
} from "../src/index.ts";

const blobs = [
  { x: 0.35, y: 0.4, rx: 0.2, ry: 0.1, tilt: 0.5 },
  { x: 0.55, y: 0.55, rx: 0.1, ry: 0.15, tilt: -0.4 },
  { x: 0.45, y: 0.3, rx: 0.06, ry: 0.06, tilt: 0 },
  { x: 0.62, y: 0.35, rx: 0.09, ry: 0.05, tilt: 1.1 },
];

function section(px: number, py: number): number {
  let value = 0;
  for (const blob of blobs) {
    const dx = px - blob.x;
    const dy = py - blob.y;
    const u = dx * Math.cos(blob.tilt) + dy * Math.sin(blob.tilt);
    const v = -dx * Math.sin(blob.tilt) + dy * Math.cos(blob.tilt);
    if ((u / blob.rx) ** 2 + (v / blob.ry) ** 2 <= 1) value = Math.max(value, 0.8);
  }
  return value;
}

const size = { width: 120, height: 90 };

function render(paint: (px: number, py: number) => number, tone: (v: number) => number): GrayImage {
  const data = new Float32Array(size.width * size.height);
  for (let y = 0; y < size.height; y++) {
    for (let x = 0; x < size.width; x++) {
      data[y * size.width + x] = tone(paint((x + 0.5) / size.width, (y + 0.5) / size.height));
    }
  }
  return { ...size, data };
}

function transformed(angle: number, shiftX: number, shiftY: number) {
  const radians = (angle * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const aspect = size.height / size.width;
  return (qx: number, qy: number) => {
    const ux = qx - 0.5 - shiftX;
    const uy = (qy - 0.5 - shiftY) * aspect;
    const rx = ux * cos + uy * sin;
    const ry = (-ux * sin + uy * cos) / aspect;
    return section(rx + 0.5, ry + 0.5);
  };
}

const whiteBackground = (v: number) => 1 - v;
const stainedBackground = (v: number) => 0.95 - v * 0.6;

test("a section turned by 20 degrees and shifted is recovered within tolerance", () => {
  const first = render(section, whiteBackground);
  const second = render(transformed(20, 0.04, -0.03), stainedBackground);
  const found = registerThumbnails(first, second);
  assert.ok(found !== null);
  assert.ok(Math.abs(found.rotation - 20) <= 3, `rotation ${found.rotation}`);
  assert.ok(Math.abs(found.shiftX - 0.04) <= 0.03, `shiftX ${found.shiftX}`);
  assert.ok(Math.abs(found.shiftY + 0.03) <= 0.03, `shiftY ${found.shiftY}`);
});

test("a section turned the other way is recovered too", () => {
  const first = render(section, whiteBackground);
  const second = render(transformed(-35, 0, 0), whiteBackground);
  const found = registerThumbnails(first, second);
  assert.ok(found !== null);
  assert.ok(Math.abs(found.rotation + 35) <= 3, `rotation ${found.rotation}`);
});

test("identical sections need no change", () => {
  const first = render(section, whiteBackground);
  const found = registerThumbnails(first, first);
  assert.ok(found !== null);
  assert.ok(Math.abs(found.rotation) <= 1);
  assert.ok(Math.abs(found.shiftX) <= 0.01 && Math.abs(found.shiftY) <= 0.01);
});

test("blank slides give no proposal", () => {
  const blank = render(() => 0, whiteBackground);
  assert.equal(registerThumbnails(blank, blank), null);
});

test("an aligned offset keeps the pair linked through later moves", () => {
  const start = moveView(createLinkedViews(["left", "right"]), "left", {
    x: 800,
    y: 500,
    zoom: -1,
    rotation: 0,
  });
  const aligned = alignWithOffset(start, "left", "right", {
    x: 60,
    y: -20,
    zoom: 0,
    rotation: -20,
  });
  assert.deepEqual(aligned.views.right, { x: 860, y: 480, zoom: -1, rotation: -20 });
  const moved = moveView(aligned, "left", { x: 900, y: 500, zoom: -1, rotation: 10 });
  assert.deepEqual(moved.views.right, { x: 960, y: 480, zoom: -1, rotation: -10 });
});
