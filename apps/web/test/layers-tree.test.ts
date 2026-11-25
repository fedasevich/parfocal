import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  type AnnotationDocument,
  addGroup,
  addShape,
  createDocument,
  isShapeHidden,
  isShapeLocked,
  itemOf,
  removeShape,
  updateGroup,
} from "../src/annotations/document.ts";
import { mergeFile, readFile, toOwnJson } from "../src/annotations/interchange.ts";
import type { LayerContext } from "../src/annotations/layers.ts";
import {
  classGroupKey,
  dropRows,
  groupKey,
  materialiseClass,
  membersOf,
  noClassName,
  openKeysFor,
  rangeOf,
  renameShape,
  shapeKey,
  type TreeRow,
  toggleShapeHidden,
  toggleShapeLocked,
  treeRows,
  unionBounds,
} from "../src/annotations/layers-tree.ts";
import { layerGroupsOf, withSavedGroups } from "../src/annotations/saved-groups.ts";
import type { Shape } from "../src/annotations/shapes.ts";

const context: LayerContext = {
  classes: [
    { id: "tumor", name: "Tumor", colour: "#f87171" },
    { id: "immune", name: "Immune", colour: "#38bdf8" },
  ],
  regions: [],
};

const labelOf = (shape: Shape) => `S${shape.id}`;

const square = (x: number) => new Float32Array([x, 0, x + 10, 0, x + 10, 10, x, 10]);

function cells(classes: readonly (string | null)[]) {
  let doc = createDocument();
  for (const [index, classKey] of classes.entries()) {
    doc = addShape(doc, { kind: "polygon", points: square(index * 20), classKey }).document;
  }
  return doc;
}

const keysOf = (rows: readonly TreeRow[]) => rows.map((row) => row.key);

const rowsOf = (doc: AnnotationDocument, open: readonly string[] = []) =>
  treeRows(doc, context, new Set(open), labelOf).rows;

describe("the layers tree", () => {
  test("loose shapes sit in collapsed class groups in class order, no class last", () => {
    const doc = cells([null, "immune", "tumor", "tumor"]);
    const rows = rowsOf(doc);
    assert.deepEqual(keysOf(rows), [classGroupKey("tumor"), classGroupKey("immune"), "c:"]);
    assert.deepEqual(
      rows.map((row) => (row.kind === "group" ? [row.name, row.count, row.expanded] : null)),
      [
        ["Tumor", 2, false],
        ["Immune", 1, false],
        [noClassName, 1, false],
      ],
    );
  });

  test("saved groups come first, nest, and show their shapes only when open", () => {
    let doc = cells(["tumor", "tumor", "immune"]);
    const outer = addGroup(doc, "Outer");
    const inner = addGroup(outer.document, "Inner", { parentId: outer.group.id });
    doc = dropRows(inner.document, [shapeKey(1)], { key: groupKey(2), place: "into" }, context);
    doc = dropRows(doc, [shapeKey(2)], { key: groupKey(1), place: "into" }, context);
    assert.deepEqual(keysOf(rowsOf(doc)), ["g:1", classGroupKey("immune")]);
    const open = rowsOf(doc, ["g:1", "g:2"]);
    assert.deepEqual(keysOf(open), ["g:1", "g:2", "s:1", "s:2", classGroupKey("immune")]);
    const outerRow = open[0];
    assert.equal(outerRow?.kind === "group" ? outerRow.count : 0, 2);
    assert.equal(open[2]?.depth, 2);
  });

  test("a hidden group hides its rows below and counts its objects as hidden", () => {
    let doc = cells(["tumor", "tumor"]);
    const made = materialiseClass(doc, "tumor", context);
    assert.ok(made);
    doc = updateGroup(made.document, made.groupId, { hidden: true }).document;
    const tree = treeRows(doc, context, new Set([groupKey(made.groupId)]), labelOf);
    assert.equal(tree.hiddenObjects, 2);
    assert.equal(tree.rows[1]?.hiddenAbove, true);
  });

  test("a class group becomes a saved group with the class name and colour", () => {
    const doc = cells(["tumor", "immune", "tumor"]);
    const made = materialiseClass(doc, "tumor", context);
    assert.ok(made);
    const group = made.document.groups.get(made.groupId);
    assert.equal(group?.name, "Tumor");
    assert.deepEqual(group?.color, [248, 113, 113]);
    assert.deepEqual(membersOf(made.document, groupKey(made.groupId)), [1, 3]);
    assert.deepEqual(membersOf(made.document, classGroupKey("immune")), [2]);
  });

  test("dropping a shape into a class group saves the group and moves the shape in", () => {
    const doc = cells(["tumor", "immune"]);
    const next = dropRows(
      doc,
      [shapeKey(2)],
      { key: classGroupKey("tumor"), place: "into" },
      context,
    );
    const home = next.shapes.get(2)?.groupId ?? null;
    assert.notEqual(home, null);
    assert.equal(next.groups.get(home ?? 0)?.name, "Tumor");
    assert.equal(next.shapes.get(1)?.groupId, home);
  });

  test("dropping before and after reorders shapes in the tree only", () => {
    let doc = cells(["tumor", "tumor", "tumor"]);
    const made = materialiseClass(doc, "tumor", context);
    assert.ok(made);
    doc = made.document;
    const key = groupKey(made.groupId);
    doc = dropRows(doc, [shapeKey(3)], { key: shapeKey(1), place: "before" }, context);
    assert.deepEqual(keysOf(rowsOf(doc, [key])).slice(1), ["s:3", "s:1", "s:2"]);
    doc = dropRows(doc, [shapeKey(3)], { key: shapeKey(2), place: "after" }, context);
    assert.deepEqual(keysOf(rowsOf(doc, [key])).slice(1), ["s:1", "s:2", "s:3"]);
    assert.deepEqual([...doc.shapes.keys()], [1, 2, 3]);
  });

  test("groups reorder by rank and a group never drops into itself", () => {
    let doc = cells([]);
    doc = addGroup(doc, "A").document;
    doc = addGroup(doc, "B", { parentId: 1 }).document;
    doc = addGroup(doc, "C").document;
    const moved = dropRows(doc, [groupKey(3)], { key: groupKey(1), place: "before" }, context);
    assert.deepEqual(keysOf(rowsOf(moved)), ["g:3", "g:1"]);
    assert.equal(dropRows(doc, [groupKey(1)], { key: groupKey(2), place: "into" }, context), doc);
  });

  test("a hidden or locked group refuses a drop", () => {
    let doc = cells(["tumor"]);
    const locked = addGroup(doc, "Locked", { locked: true });
    doc = locked.document;
    const refused = dropRows(
      doc,
      [shapeKey(1)],
      { key: groupKey(locked.group.id), place: "into" },
      context,
    );
    assert.equal(refused, doc);
  });

  test("a shape row hides, locks and takes a name of its own", () => {
    let doc = cells(["tumor"]);
    const shape = doc.shapes.get(1);
    assert.ok(shape);
    doc = toggleShapeHidden(doc, 1);
    doc = toggleShapeLocked(doc, 1);
    doc = renameShape(doc, 1, "  Odd nucleus  ");
    assert.equal(isShapeHidden(doc, shape), true);
    assert.equal(isShapeLocked(doc, shape), true);
    assert.equal(itemOf(doc, 1).name, "Odd nucleus");
    const row = rowsOf(doc, [classGroupKey("tumor")])[1];
    assert.equal(row?.kind === "shape" ? row.name : null, "Odd nucleus");
    doc = toggleShapeHidden(toggleShapeLocked(renameShape(doc, 1, ""), 1), 1);
    assert.equal(doc.items?.size, 0);
    assert.equal(removeShape(toggleShapeHidden(doc, 1), 1).items?.size, 0);
  });

  test("shift takes the shape rows between two rows and the bounds cover them", () => {
    const doc = cells(["tumor", "tumor", "tumor"]);
    const rows = rowsOf(doc, [classGroupKey("tumor")]);
    assert.deepEqual(rangeOf(rows, "s:3", "s:1"), [1, 2, 3]);
    assert.deepEqual(unionBounds(doc, [1, 3]), [0, 0, 50, 10]);
    assert.deepEqual(openKeysFor(doc, 2), [classGroupKey("tumor")]);
  });

  test("five thousand cells build their rows in one pass", () => {
    let doc = createDocument();
    for (let index = 0; index < 5000; index++) {
      doc = addShape(doc, {
        kind: "point",
        points: new Float32Array([index, index]),
        classKey: index % 2 === 0 ? "tumor" : "immune",
      }).document;
    }
    const started = performance.now();
    const rows = rowsOf(doc, [classGroupKey("tumor")]);
    const spent = performance.now() - started;
    assert.equal(rows.length, 2502);
    assert.ok(spent < 250, `took ${spent} ms`);
  });
});

describe("layer items are saved and exported", () => {
  test("names, hide, lock and ranks round trip through the saved body", () => {
    let doc = cells(["tumor", "tumor"]);
    const made = materialiseClass(doc, "tumor", context);
    assert.ok(made);
    doc = dropRows(made.document, [shapeKey(2)], { key: shapeKey(1), place: "before" }, context);
    doc = renameShape(toggleShapeLocked(doc, 1), 1, "Edge");
    doc = updateGroup(doc, made.groupId, { rank: 0.5 }).document;
    const remotes = new Map([
      [1, { id: "ra" }],
      [2, { id: "rb" }],
    ]);
    const body = layerGroupsOf(doc, remotes);
    assert.equal(body.groups?.[0]?.rank, 0.5);
    assert.deepEqual(
      body.items?.map((item) => [item.annotation_id, item.name, item.locked]),
      [
        ["ra", "Edge", true],
        ["rb", null, false],
      ],
    );
    const fresh = cells(["tumor", "tumor"]);
    const restored = withSavedGroups(fresh, body, remotes);
    assert.deepEqual(layerGroupsOf(restored, remotes), body);
    assert.equal(itemOf(restored, 1).name, "Edge");
  });

  test("items without any group still load", () => {
    const doc = toggleShapeHidden(cells(["tumor"]), 1);
    const remotes = new Map([[1, { id: "ra" }]]);
    const restored = withSavedGroups(cells(["tumor"]), layerGroupsOf(doc, remotes), remotes);
    assert.equal(itemOf(restored, 1).hidden, true);
  });

  test("the own JSON export carries the layer item and group rank back in", () => {
    let doc = cells(["tumor"]);
    doc = renameShape(toggleShapeHidden(doc, 1), 1, "Edge");
    doc = addGroup(doc, "Ranked", { rank: 3 }).document;
    const merged = mergeFile(createDocument(), readFile(JSON.stringify(toOwnJson(doc))), "f.json");
    const [added] = merged.added;
    assert.ok(added !== undefined);
    assert.equal(itemOf(merged.document, added).name, "Edge");
    assert.equal(itemOf(merged.document, added).hidden, true);
    assert.ok([...merged.document.groups.values()].some((group) => group.rank === 3));
  });
});
