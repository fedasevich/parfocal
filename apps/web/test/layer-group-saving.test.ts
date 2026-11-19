import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { addGroup, addShape, createDocument } from "../src/annotations/document.ts";
import {
  deleteGroupWithShapes,
  moveToGroup,
  renameGroup,
  skippedTarget,
} from "../src/annotations/layers.ts";
import { layerGroupsOf, withSavedGroups } from "../src/annotations/saved-groups.ts";

const square = new Float32Array([0, 0, 10, 0, 10, 10, 0, 10]);

function sample() {
  let doc = createDocument();
  const outer = addGroup(doc, "Outer", { color: [1, 2, 3] });
  doc = outer.document;
  const inner = addGroup(doc, "Inner", { parentId: outer.group.id, locked: true });
  doc = inner.document;
  const a = addShape(doc, { kind: "polygon", points: square, groupId: outer.group.id });
  const b = addShape(a.document, { kind: "polygon", points: square, groupId: inner.group.id });
  const c = addShape(b.document, { kind: "polygon", points: square });
  return {
    doc: c.document,
    outer: outer.group,
    inner: inner.group,
    a: a.shape,
    b: b.shape,
    c: c.shape,
  };
}

describe("layer group saving", () => {
  test("a document round trips through the saved body", () => {
    const { doc, a, b, c } = sample();
    const remotes = new Map([
      [a.id, { id: "ra" }],
      [b.id, { id: "rb" }],
      [c.id, { id: "rc" }],
    ]);
    const body = layerGroupsOf(doc, remotes);
    assert.equal(body.groups?.length, 2);
    assert.deepEqual(
      body.members?.map((member) => member.annotation_id),
      ["ra", "rb"],
    );
    let fresh = createDocument();
    const loaded = new Map<number, { id: string }>();
    for (const remote of ["ra", "rb", "rc"]) {
      const added = addShape(fresh, { kind: "polygon", points: square });
      fresh = added.document;
      loaded.set(added.shape.id, { id: remote });
    }
    const restored = withSavedGroups(fresh, body, loaded);
    assert.deepEqual(layerGroupsOf(restored, loaded), body);
    assert.equal(restored.nextGroupId, 3);
  });

  test("deleting a group removes its shapes and nested groups", () => {
    const { doc, outer, c } = sample();
    const gone = deleteGroupWithShapes(doc, outer.id);
    assert.equal(gone.groups.size, 0);
    assert.deepEqual([...gone.shapes.keys()], [c.id]);
    assert.equal(deleteGroupWithShapes(doc, 99), doc);
  });

  test("shapes move into a group and a group is renamed", () => {
    const { doc, outer, c } = sample();
    const moved = moveToGroup(doc, [c.id], outer.id);
    assert.equal(moved.shapes.get(c.id)?.groupId, outer.id);
    assert.equal(moveToGroup(moved, [c.id], outer.id), moved);
    assert.equal(renameGroup(doc, outer.id, "  Margin ").groups.get(outer.id)?.name, "Margin");
    assert.equal(renameGroup(doc, outer.id, "  "), doc);
  });

  test("a locked target is reported when a new shape lands outside it", () => {
    const { doc, inner } = sample();
    const added = addShape(doc, { kind: "polygon", points: square });
    assert.deepEqual(skippedTarget(doc, added.document, inner.id), {
      name: "Inner",
      reason: "locked",
    });
    assert.equal(skippedTarget(doc, doc, inner.id), null);
    assert.equal(skippedTarget(doc, added.document, null), null);
  });
});
