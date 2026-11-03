import assert from "node:assert/strict";
import { test } from "node:test";
import type { SlideDetail } from "@parfocal/api-client";
import {
  blockChoices,
  draftOf,
  moveSlide,
  orderChanged,
  slideChange,
  slideErrors,
} from "../src/screens/project/slide-edits.ts";

const slide = (id: string, label: string, more: Partial<SlideDetail> = {}): SlideDetail => ({
  id,
  label,
  block_id: null,
  barcode: null,
  stain: "H&E",
  level: null,
  restricted_images: [],
  ...more,
});

const slides = [slide("a", "A1"), slide("b", "A2", { level: 2 }), slide("c", "A3")];

test("a slide moves one place up or down and stops at either end", () => {
  assert.deepEqual(
    moveSlide(slides, "b", -1).map((row) => row.label),
    ["A2", "A1", "A3"],
  );
  assert.deepEqual(
    moveSlide(slides, "b", 1).map((row) => row.label),
    ["A1", "A3", "A2"],
  );
  assert.equal(moveSlide(slides, "a", -1), slides);
  assert.equal(moveSlide(slides, "c", 1), slides);
  assert.equal(moveSlide(slides, "missing", 1), slides);
});

test("the order counts as changed only when a slide sits somewhere new", () => {
  const drafts = slides.map(draftOf);
  assert.equal(orderChanged(slides, drafts), false);
  assert.equal(orderChanged(slides, moveSlide(drafts, "c", -1)), true);
});

test("a change sends only the fields that differ, trimmed, and null clears block and level", () => {
  const before = slide("b", "A2", { level: 2, block_id: "block-1" });
  assert.equal(slideChange(before, draftOf(before)), null);
  assert.deepEqual(slideChange(before, { ...draftOf(before), label: " A2-x ", stain: "PAS" }), {
    label: "A2-x",
    stain: "PAS",
  });
  assert.deepEqual(slideChange(before, { ...draftOf(before), blockId: null, level: "" }), {
    block_id: null,
    level: null,
  });
  assert.deepEqual(slideChange(before, { ...draftOf(before), level: "3" }), { level: 3 });
});

test("a draft needs a unique label, a stain and a level from 1 to 50", () => {
  const drafts = slides.map(draftOf);
  const first = drafts[0];
  assert.ok(first);
  assert.deepEqual(slideErrors(first, drafts), []);
  assert.deepEqual(slideErrors({ ...first, label: "A2" }, drafts), [
    "Another slide is already labelled A2.",
  ]);
  assert.deepEqual(slideErrors({ ...first, label: " ", stain: "", level: "51" }, drafts), [
    "Give the slide a label.",
    "Give the stain.",
    "The level is a whole number from 1 to 50.",
  ]);
  assert.deepEqual(slideErrors({ ...first, level: "1.5" }, drafts), [
    "The level is a whole number from 1 to 50.",
  ]);
});

test("blocks are offered by specimen letter and block number", () => {
  assert.deepEqual(
    blockChoices([
      {
        id: "s",
        letter: "B",
        type: null,
        site: null,
        laterality: "left",
        procedure: null,
        collected_at: null,
        received_at: null,
        blocks: [{ id: "k", number: 2, description: null, stains: [], levels: 1 }],
      },
    ]),
    [{ id: "k", name: "B2" }],
  );
});
