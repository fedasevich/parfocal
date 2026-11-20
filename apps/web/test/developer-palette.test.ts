import assert from "node:assert/strict";
import { test } from "node:test";
import { isSlidePath } from "../src/lab/developer-drawer-state.ts";
import { type PaletteContext, paletteEntries } from "../src/shell/palette-commands.ts";

const contextOf = (
  developerAllowed: boolean,
  developerMode: boolean,
  opened: (string | undefined)[] = [],
): PaletteContext => ({
  projectId: "p",
  onSlide: true,
  developerMode,
  developerAllowed,
  openDeveloper: (section) => {
    opened.push(section);
  },
  go: () => {},
  measure: () => {},
  openNotifications: () => {},
  setDeveloperMode: () => {},
  showAllHints: () => {},
});

test("people without the developer permission see no developer commands", () => {
  const ids = paletteEntries(contextOf(false, true)).map((entry) => entry.id);
  assert.ok(!ids.includes("developer-drawer"));
  assert.ok(!ids.includes("setting-developer-mode"));
  assert.ok(!ids.some((id) => id.startsWith("lab-")));
});

test("a researcher gets a Developer mode command that opens the drawer", () => {
  const opened: (string | undefined)[] = [];
  const entries = paletteEntries(contextOf(true, false, opened));
  const drawer = entries.find((entry) => entry.id === "developer-drawer");
  assert.equal(drawer?.label, "Developer mode");
  assert.equal(drawer?.group, "Lab");
  drawer?.run();
  assert.deepEqual(opened, [undefined]);
  assert.ok(!entries.some((entry) => entry.id.startsWith("lab-")));
});

test("with developer mode on, each section command opens the drawer at that section", () => {
  const opened: (string | undefined)[] = [];
  const entries = paletteEntries(contextOf(true, true, opened));
  entries.find((entry) => entry.id === "lab-hud")?.run();
  entries.find((entry) => entry.id === "lab-annot")?.run();
  assert.deepEqual(opened, ["hud", "annot"]);
});

test("the drawer opens over slide pages only", () => {
  assert.ok(isSlidePath("/projects/p1/slides/s1"));
  assert.ok(isSlidePath("/projects/p1/slides/s1/annotate"));
  assert.ok(!isSlidePath("/projects/p1"));
  assert.ok(!isSlidePath("/developer"));
});
