import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import {
  clampInspectorWidth,
  defaultInspectorLayout,
  dragInspector,
  readInspectorLayout,
  writeInspectorLayout,
} from "../src/screens/review/inspector-layout.ts";

const memory = new Map<string, string>();

beforeEach(() => {
  memory.clear();
  const storage = {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => void memory.set(key, value),
  };
  Object.assign(globalThis, {
    window: { localStorage: storage, dispatchEvent: () => true, addEventListener: () => {} },
  });
});

test("the width opens at 340 and is kept between 280 and 560", () => {
  assert.equal(defaultInspectorLayout.width, 340);
  assert.equal(clampInspectorWidth(100), 280);
  assert.equal(clampInspectorWidth(300), 300);
  assert.equal(clampInspectorWidth(900), 560);
});

test("dragging below 220 hides the panel and above it keeps it", () => {
  assert.deepEqual(dragInspector(219), { width: 280, hidden: true });
  assert.deepEqual(dragInspector(220), { width: 280, hidden: false });
  assert.deepEqual(dragInspector(400), { width: 400, hidden: false });
  assert.deepEqual(dragInspector(700), { width: 560, hidden: false });
});

test("each user keeps their own width, hidden state and option", () => {
  writeInspectorLayout("u1", { width: 480, hidden: true, hideWhilePanning: true });
  writeInspectorLayout("u2", { width: 300, hidden: false, hideWhilePanning: false });
  assert.deepEqual(readInspectorLayout("u1"), { width: 480, hidden: true, hideWhilePanning: true });
  assert.equal(readInspectorLayout("u2").width, 300);
  assert.deepEqual(readInspectorLayout("u3"), defaultInspectorLayout);
});

test("damaged storage falls back to the defaults", () => {
  memory.set("parfocal.inspector-panel", "{nope");
  assert.deepEqual(readInspectorLayout("u1"), defaultInspectorLayout);
  memory.set("parfocal.inspector-panel", JSON.stringify({ u1: { width: "wide", hidden: 1 } }));
  assert.deepEqual(readInspectorLayout("u1"), defaultInspectorLayout);
});
