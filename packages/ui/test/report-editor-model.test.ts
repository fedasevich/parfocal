import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addBlock,
  blockFields,
  blockKinds,
  createBlock,
  duplicateBlock,
  insertionIndex,
  moveBlock,
  moveBlockTo,
  paginate,
  removeBlock,
  selectedValue,
  setBlockField,
  toApiBlocks,
  toEditorBlocks,
  toggleIn,
} from "../src/lib/report-editor-model.ts";

test("every kind of block starts with settings the API accepts", () => {
  for (const kind of blockKinds) {
    const block = createBlock(kind);
    assert.equal(block.kind, kind);
    assert.ok(block.title.length > 0);
    assert.equal(block.width, "full");
    assert.equal(block.page_break, false);
    for (const field of blockFields[kind]) {
      assert.ok(field.key in block, `${kind} has ${field.key}`);
    }
  }
  assert.deepEqual(createBlock("headline-numbers")["metrics"], [
    "sensitivity",
    "precision",
    "dice",
  ]);
});

test("blocks of one kind keep their own settings", () => {
  const first = createBlock("headline-numbers");
  const second = createBlock("headline-numbers");
  assert.notEqual(first.id, second.id);
  const changed = setBlockField([first, second], second.id, "metrics", ["dice"]);
  assert.deepEqual(changed[0]?.["metrics"], ["sensitivity", "precision", "dice"]);
  assert.deepEqual(changed[1]?.["metrics"], ["dice"]);
});

test("adding goes after the selected block, or at the end with none selected", () => {
  const a = createBlock("text");
  const b = createBlock("text");
  assert.equal(insertionIndex([a, b], a.id), 1);
  assert.equal(insertionIndex([a, b], null), 2);
  const added = addBlock([a, b], "slide-table", 1);
  assert.deepEqual(
    added.blocks.map((block) => block.kind),
    ["text", "slide-table", "text"],
  );
  assert.equal(added.added.kind, "slide-table");
});

test("moving stops at the ends and moving to an index reorders", () => {
  const a = createBlock("text");
  const b = createBlock("comparison");
  const c = createBlock("ai-changes");
  assert.deepEqual(
    moveBlock([a, b, c], a.id, -1).map((block) => block.id),
    [a.id, b.id, c.id],
  );
  assert.deepEqual(
    moveBlock([a, b, c], a.id, 1).map((block) => block.id),
    [b.id, a.id, c.id],
  );
  assert.deepEqual(
    moveBlockTo([a, b, c], a.id, 3).map((block) => block.id),
    [b.id, c.id, a.id],
  );
  assert.deepEqual(
    moveBlockTo([a, b, c], c.id, 0).map((block) => block.id),
    [c.id, a.id, b.id],
  );
});

test("duplicating copies the settings after the original and removing drops it", () => {
  const a = createBlock("worst-objects");
  const edited = setBlockField([a], a.id, "rows", 20);
  const result = duplicateBlock(edited, a.id);
  assert.equal(result.blocks.length, 2);
  assert.equal(result.added?.["rows"], 20);
  assert.notEqual(result.added?.id, a.id);
  assert.deepEqual(
    removeBlock(result.blocks, a.id).map((block) => block.id),
    [result.added?.id],
  );
});

test("a list of choices keeps its order and its last choice", () => {
  const order = ["a", "b", "c"];
  assert.deepEqual(toggleIn(["a"], "c", order, true), ["a", "c"]);
  assert.deepEqual(toggleIn(["a", "c"], "a", order, true), ["c"]);
  assert.deepEqual(toggleIn(["c"], "c", order, true), ["c"]);
  assert.deepEqual(toggleIn(["c"], "c", order, false), []);
});

test("a break starts a new page except before the first block", () => {
  const a = { ...createBlock("text"), page_break: true };
  const b = createBlock("text");
  const c = { ...createBlock("text"), page_break: true };
  assert.deepEqual(
    paginate([a, b, c]).map((page) => page.blocks.length),
    [2, 1],
  );
  assert.equal(paginate([]).length, 1);
});

test("select values turn back into numbers and nulls", () => {
  const rows = blockFields["region-metrics"].find((field) => field.key === "rows");
  assert.ok(rows);
  assert.equal(selectedValue(rows, "all"), null);
  assert.equal(selectedValue(rows, "6"), 6);
});

test("saved blocks keep their settings and lose the editor id", () => {
  const loaded = toEditorBlocks([
    { kind: "text", title: "Methods", body: "Two readers." } as { kind: string; title: string },
  ]);
  assert.equal(loaded[0]?.["body"], "Two readers.");
  assert.equal(loaded[0]?.show_title, true);
  const saved = toApiBlocks(loaded);
  assert.equal("id" in (saved[0] ?? {}), false);
  assert.equal(saved[0]?.["title"], "Methods");
});
