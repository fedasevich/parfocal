import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  adminSections,
  connectModelScenes,
  onboardingScenes,
  sectionOf,
} from "../src/screens/onboarding/scenes.ts";

test("the sign-in, sign-up, invite, setup and admin scenes match the PROTO-001 inventory", () => {
  const inventory = readFileSync(
    new URL("../../../docs/design/prototype-inventory.md", import.meta.url),
    "utf8",
  );
  for (const [screen, scenes] of Object.entries(onboardingScenes)) {
    const row = inventory.split("\n").find((line) => line.startsWith(`| \`${screen}\` |`));
    assert.ok(row, `the inventory lists ${screen}`);
    const cell = row.split("|")[3] ?? "";
    assert.deepEqual(
      [...cell.matchAll(/`(\w+)`/g)].map((match) => match[1]),
      [...scenes],
      screen,
    );
  }
});

test("an admin scene picks the section it is shown in", () => {
  for (const section of adminSections) assert.equal(sectionOf(undefined, section), section);
  assert.equal(sectionOf("people", "tplnew"), "templates");
  assert.equal(sectionOf("people", "tpledit"), "templates");
  for (const scene of connectModelScenes) assert.equal(sectionOf(undefined, scene), "models");
  assert.equal(sectionOf("audit", undefined), "audit");
  assert.equal(sectionOf(undefined, undefined), "overview");
});
