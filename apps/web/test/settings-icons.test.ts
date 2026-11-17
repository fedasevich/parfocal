import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("settings entries in the shell and the project use the gear, never the sun", () => {
  const files = [
    "../src/shell/account-menu.tsx",
    "../src/shell/palette-commands.ts",
    "../src/screens/project/project-page.tsx",
    "../src/screens/project/tasks-tab.tsx",
  ];
  for (const file of files) {
    const lines = read(file).split("\n");
    const settingsLines = lines.filter((line) => /settings/i.test(line) && /icon/i.test(line));
    for (const line of settingsLines) {
      assert.doesNotMatch(line, /"sun"/, `${file}: ${line.trim()}`);
    }
  }
  assert.match(read("../src/shell/account-menu.tsx"), /icon: "gear", label: t`Settings`/);
});

test("the gear glyph is a toothed cog, not a ring of rays like the sun", () => {
  const set = read("../../../packages/ui/src/components/icon-set.tsx");
  const gear = set.slice(set.indexOf("  gear: {"), set.indexOf("  help: {"));
  const sun = set.slice(set.indexOf("  sun: {"), set.indexOf("  sliders: {"));
  const gearPath = /<path d="([^"]+)"/.exec(gear)?.[1] ?? "";
  const sunPath = /<path d="([^"]+)"/.exec(sun)?.[1] ?? "";
  assert.ok(gearPath.length > 0);
  assert.notEqual(gearPath, sunPath);
  assert.match(gearPath, /z$/);
  assert.doesNotMatch(gearPath, /^M12 2\.5v/);
});
