import assert from "node:assert/strict";
import { test } from "node:test";
import { createBlock } from "@parfocal/ui/lib/report-editor-model";
import {
  editorHead,
  emptyPresets,
  formatOf,
  nameProblem,
  saveHint,
  scopeFor,
  templateBody,
} from "../src/screens/admin/template-model.ts";

const library = [{ name: "Detection study" }, { name: "Cell typing study" }];

test("a template name is checked against the library, ignoring case and the template itself", () => {
  assert.equal(nameProblem("", library), "Give the template a name.");
  assert.equal(nameProblem("A", library), "Use at least 2 characters.");
  assert.match(nameProblem("detection STUDY", library) ?? "", /already exists/);
  assert.equal(nameProblem("Detection study", library, "Detection study"), undefined);
  assert.equal(nameProblem("Reader study", library), undefined);
});

test("changing the objects to check brings the parameter that kind needs", () => {
  const regions = { kind: "all-regions" } as const;
  assert.deepEqual(scopeFor("random-cells", regions), { kind: "random-cells", count: 100 });
  assert.deepEqual(scopeFor("cells-below-score", regions), {
    kind: "cells-below-score",
    score: 0.5,
  });
  assert.deepEqual(scopeFor("inside-rois", { kind: "random-cells", count: 40 }), {
    kind: "inside-rois",
  });
  const kept = { kind: "random-cells", count: 40 } as const;
  assert.equal(scopeFor("random-cells", kept), kept);
});

test("the saved body carries the blocks with their settings and the whole format", () => {
  const text = { ...createBlock("text"), body: "Two readers." };
  const body = templateBody({
    name: "  Reader study ",
    kind: "reviewers-first",
    blocks: [text, createBlock("headline-numbers")],
    format: { ...formatOf(undefined), paper: "letter" },
    presets: emptyPresets,
  });
  assert.equal(body.name, "Reader study");
  assert.equal(body.study_kind, "reviewers-first");
  assert.deepEqual(
    body.blocks.map((block) => block.kind),
    ["text", "headline-numbers"],
  );
  assert.equal("id" in (body.blocks[0] ?? {}), false);
  assert.equal(body.format?.paper, "letter");
  assert.deepEqual(body.format?.downloads, ["pdf", "docx", "decisions", "objects", "geojson"]);
});

test("a new paper choice overrides the format of the template it starts from", () => {
  assert.equal(formatOf(undefined, "letter").paper, "letter");
  assert.equal(formatOf(undefined).paper, "a4");
});

test("the editor head and save hint say what saving does", () => {
  const draft = { name: "Reader study", kind: "cells", from: null, paper: "a4" } as const;
  assert.equal(editorHead(draft).sub, "Cells · a new template");
  assert.match(saveHint(draft), /adds it to the library as v1/);
});
