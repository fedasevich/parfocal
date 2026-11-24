import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { anchorSelector } from "../src/app-tour/tour-selector.ts";

const sourceFiles = (directory: string): string[] =>
  readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (name === "node_modules" || name === "locales") return [];
    return statSync(path).isDirectory() ? sourceFiles(path) : [path];
  });

const roots = [
  join(import.meta.dirname, "../src"),
  join(import.meta.dirname, "../../../packages/ui/src"),
];
const sources = roots
  .flatMap(sourceFiles)
  .filter((path) => /\.(ts|tsx)$/.test(path))
  .map((path) => readFileSync(path, "utf8"));
const everything = sources.join("\n");

const chapters = readFileSync(
  join(import.meta.dirname, "../src/app-tour/tour-chapters.ts"),
  "utf8",
);
const steps = readFileSync(join(import.meta.dirname, "../src/app-tour/tour-steps.ts"), "utf8");
const anchors = [...(chapters + steps).matchAll(/anchor: (["'`])(.+?)\1,/g)].map(
  (match) => match[2] ?? "",
);

test("the tour has anchors for every chapter step", () => {
  assert.ok(anchors.length > 80, `found ${anchors.length} anchors`);
});

test("every named anchor is a real data-tour or data-testid in the app", () => {
  for (const anchor of anchors) {
    for (const part of anchor.split("|")) {
      if (part === "main" || part.startsWith("[")) continue;
      if (part.startsWith("#")) {
        assert.ok(everything.includes(`data-testid="${part.slice(1)}"`), `testid ${part}`);
      } else {
        assert.ok(everything.includes(`data-tour="${part}"`), `data-tour ${part}`);
      }
    }
  }
});

test("anchors turn into one selector each", () => {
  assert.equal(anchorSelector("bell"), '[data-tour="bell"]');
  assert.equal(anchorSelector("#slide-stage|main"), '[data-testid="slide-stage"],main');
  assert.equal(anchorSelector('[data-slot="stepper"]'), '[data-slot="stepper"]');
});

const dashes = new RegExp(["\\u2013", "\\u2014"].join("|"));
const oldWord = new RegExp(["ver", "dict"].join(""), "i");

test("the tour wording uses no dashes and never the old word for a decision", () => {
  const wording = [...chapters.matchAll(/msg`([^`]*)`/g)].map((match) => match[1] ?? "");
  assert.ok(wording.length > 80);
  for (const text of wording) {
    assert.doesNotMatch(text, dashes, text);
    assert.doesNotMatch(text, oldWord, text);
  }
});
