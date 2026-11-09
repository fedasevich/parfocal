import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clampInspectorWidth,
  defaultInspectorLayout,
  dragInspector,
  layoutOfSettings,
  settingsOfLayoutPatch,
} from "../src/screens/review/inspector-layout.ts";

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

test("the saved settings become the panel layout", () => {
  assert.deepEqual(
    layoutOfSettings({ side_panel_width: 420, hide_side_panel: true, panel_while_moving: "auto" }),
    { width: 420, hidden: true, hideWhilePanning: true },
  );
  assert.deepEqual(
    layoutOfSettings({
      side_panel_width: 340,
      hide_side_panel: false,
      panel_while_moving: "pinned",
    }),
    defaultInspectorLayout,
  );
});

test("a panel change becomes only the settings it touches", () => {
  assert.deepEqual(settingsOfLayoutPatch({ width: 900 }), { side_panel_width: 560 });
  assert.deepEqual(settingsOfLayoutPatch({ hidden: true }), { hide_side_panel: true });
  assert.deepEqual(settingsOfLayoutPatch({ hideWhilePanning: false }), {
    panel_while_moving: "pinned",
  });
  assert.deepEqual(settingsOfLayoutPatch({}), {});
});
