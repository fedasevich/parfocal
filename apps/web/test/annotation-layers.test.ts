import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { addGroup, addShape, createDocument, updateGroup } from "../src/annotations/document.ts";
import { pickShape, shapesInExtent } from "../src/annotations/hit-test.ts";
import {
  addLayer,
  bucketsOf,
  groupBy,
  groupShapes,
  hexOfRgb,
  intoGroup,
  type LayerContext,
  layerRows,
  overlaysHidden,
  rgbOfHex,
  setOverlaysHidden,
  toggleHidden,
  toggleLocked,
  ungroupShapes,
  usableTarget,
} from "../src/annotations/layers.ts";

const square = (x: number, y: number, size: number) =>
  new Float32Array([x, y, x + size, y, x + size, y + size, x, y + size]);

const context: LayerContext = {
  classes: [
    { id: "tumor", name: "Tumor", colour: "#f87171" },
    { id: "immune", name: "Immune", colour: "#38bdf8" },
  ],
  regions: [{ name: "T1", extent: [0, 0, 1000, 1000] }],
};

function drawn(count: number, options: { classKey?: string; x?: number } = {}) {
  let doc = createDocument();
  const ids: number[] = [];
  for (let index = 0; index < count; index++) {
    const added = addShape(doc, {
      kind: "polygon",
      points: square((options.x ?? 0) + index * 200, 0, 100),
      classKey: options.classKey ?? null,
    });
    doc = added.document;
    ids.push(added.shape.id);
  }
  return { doc, ids };
}

describe("layer rows", () => {
  test("a group shows the shapes of its children in its count and children follow it", () => {
    const { doc, ids } = drawn(3, { classKey: "tumor" });
    const outer = groupShapes(doc, ids, "Tumor")?.document ?? doc;
    const inner = groupShapes(outer, [ids[0] ?? 0], "Reviewed");
    const rows = layerRows(inner?.document ?? doc, context);
    assert.deepEqual(
      rows.map((row) => [row.name, row.count, row.depth]),
      [
        ["Tumor", 3, 0],
        ["Reviewed", 1, 1],
      ],
    );
    assert.equal(rows[0]?.hasChildren, true);
    assert.equal(rows[0]?.colour, "#f87171");
  });

  test("loose shapes sit in an Ungrouped row that disappears when none are left", () => {
    const { doc, ids } = drawn(2);
    assert.deepEqual(
      layerRows(doc, context).map((row) => [row.key, row.count]),
      [["ungrouped", 2]],
    );
    const grouped = groupShapes(doc, ids)?.document ?? doc;
    assert.equal(
      layerRows(grouped, context).some((row) => row.groupId === null),
      false,
    );
  });

  test("a group colour wins over the class colour", () => {
    const { doc, ids } = drawn(1, { classKey: "tumor" });
    const made = groupShapes(doc, ids, "Tumor");
    assert.ok(made);
    const coloured = updateGroup(made.document, made.group.id, { color: [1, 2, 3] }).document;
    assert.equal(layerRows(coloured, context)[0]?.colour, "rgb(1 2 3)");
  });

  test("a row under a hidden or locked parent says so", () => {
    const { doc, ids } = drawn(2);
    const outer = groupShapes(doc, ids, "Outer");
    assert.ok(outer);
    const inner = groupShapes(outer.document, [ids[0] ?? 0], "Inner");
    assert.ok(inner);
    const hidden = toggleHidden(toggleLocked(inner.document, outer.group.id), outer.group.id);
    const rows = layerRows(hidden, context);
    assert.deepEqual(
      rows.map((row) => [row.name, row.hidden, row.locked, row.hiddenAbove, row.lockedAbove]),
      [
        ["Outer", true, true, false, false],
        ["Inner", false, false, true, true],
      ],
    );
  });
});

describe("grouping and ungrouping", () => {
  test("Cmd+G puts the selected shapes in a new group inside their shared group", () => {
    const { doc, ids } = drawn(3);
    const outer = groupShapes(doc, ids, "Outer");
    assert.ok(outer);
    const inner = groupShapes(outer.document, [ids[0] ?? 0, ids[1] ?? 0]);
    assert.ok(inner);
    assert.equal(inner.document.groups.get(inner.group.id)?.parentId, outer.group.id);
    assert.equal(inner.document.shapes.get(ids[0] ?? 0)?.groupId, inner.group.id);
    assert.equal(inner.document.shapes.get(ids[2] ?? 0)?.groupId, outer.group.id);
  });

  test("shapes from different groups are grouped at the top", () => {
    const { doc, ids } = drawn(2);
    const first = groupShapes(doc, [ids[0] ?? 0], "A");
    assert.ok(first);
    const mixed = groupShapes(first.document, ids);
    assert.equal(mixed?.document.groups.get(mixed.group.id)?.parentId, null);
  });

  test("nothing to group gives nothing back", () => {
    assert.equal(groupShapes(createDocument(), [4]), null);
  });

  test("Cmd+Shift+G dissolves the group and its shapes move up one level", () => {
    const { doc, ids } = drawn(2);
    const outer = groupShapes(doc, ids, "Outer");
    assert.ok(outer);
    const inner = groupShapes(outer.document, [ids[0] ?? 0], "Inner");
    assert.ok(inner);
    const flat = ungroupShapes(inner.document, [ids[0] ?? 0]);
    assert.equal(flat.groups.has(inner.group.id), false);
    assert.equal(flat.shapes.get(ids[0] ?? 0)?.groupId, outer.group.id);
    const bare = ungroupShapes(flat, ids);
    assert.equal(bare.groups.size, 0);
    assert.equal(bare.shapes.get(ids[1] ?? 0)?.groupId, null);
  });

  test("ungrouping loose shapes changes nothing", () => {
    const { doc, ids } = drawn(2);
    assert.equal(ungroupShapes(doc, ids), doc);
  });

  test("a new empty layer can sit inside another", () => {
    const top = addLayer(createDocument(), null);
    const child = addLayer(top.document, top.group.id);
    assert.equal(child.document.groups.get(child.group.id)?.parentId, top.group.id);
  });
});

describe("hidden and locked groups in hit testing", () => {
  function scene() {
    const { doc, ids } = drawn(1);
    const made = groupShapes(doc, ids, "Layer");
    assert.ok(made);
    return { doc: made.document, id: ids[0] ?? 0, group: made.group.id };
  }

  test("a shape in a visible, unlocked group is picked and boxed", () => {
    const { doc, id } = scene();
    assert.equal(pickShape(doc, { x: 50, y: 50 }, 4)?.id, id);
    assert.deepEqual(
      shapesInExtent(doc, [0, 0, 500, 500]).map((shape) => shape.id),
      [id],
    );
  });

  test("a hidden group cannot be clicked or boxed", () => {
    const { doc, group } = scene();
    const hidden = toggleHidden(doc, group);
    assert.equal(pickShape(hidden, { x: 50, y: 50 }, 4), null);
    assert.equal(pickShape(hidden, { x: 0, y: 50 }, 4), null);
    assert.deepEqual(shapesInExtent(hidden, [0, 0, 500, 500]), []);
  });

  test("a locked group cannot be clicked or boxed", () => {
    const { doc, group } = scene();
    const locked = toggleLocked(doc, group);
    assert.equal(pickShape(locked, { x: 50, y: 50 }, 4), null);
    assert.deepEqual(shapesInExtent(locked, [0, 0, 500, 500]), []);
  });

  test("a hidden or locked parent also shuts out the shapes of its children", () => {
    const { doc, id, group } = scene();
    const child = addGroup(doc, "Child", { parentId: group });
    const moved = { ...child.document };
    const shapes = new Map(moved.shapes);
    const shape = shapes.get(id);
    assert.ok(shape);
    shapes.set(id, { ...shape, groupId: child.group.id });
    const nested = { ...moved, shapes };
    assert.equal(pickShape(nested, { x: 50, y: 50 }, 4)?.id, id);
    assert.equal(pickShape(toggleHidden(nested, group), { x: 50, y: 50 }, 4), null);
    assert.equal(pickShape(toggleLocked(nested, group), { x: 50, y: 50 }, 4), null);
  });

  test("showing and unlocking the group makes the shape reachable again", () => {
    const { doc, id, group } = scene();
    const shut = toggleLocked(toggleHidden(doc, group), group);
    assert.equal(pickShape(shut, { x: 50, y: 50 }, 4), null);
    const open = toggleLocked(toggleHidden(shut, group), group);
    assert.equal(pickShape(open, { x: 50, y: 50 }, 4)?.id, id);
  });
});

describe("the layer new shapes go to", () => {
  test("shapes drawn after the target is set land in it", () => {
    const { doc } = drawn(1);
    const target = addLayer(doc, null);
    const after = addShape(target.document, { kind: "polygon", points: square(900, 0, 50) });
    const placed = intoGroup(target.document, after.document, target.group.id);
    assert.equal(placed.shapes.get(after.shape.id)?.groupId, target.group.id);
    assert.equal(placed.shapes.get(1)?.groupId, null);
  });

  test("a target that is hidden, locked or gone is not used", () => {
    const { doc } = drawn(1);
    const target = addLayer(doc, null);
    const id = target.group.id;
    assert.equal(usableTarget(target.document, id), id);
    assert.equal(usableTarget(toggleHidden(target.document, id), id), null);
    assert.equal(usableTarget(toggleLocked(target.document, id), id), null);
    assert.equal(usableTarget(doc, id), null);
    assert.equal(usableTarget(target.document, null), null);
    const after = addShape(toggleLocked(target.document, id), {
      kind: "polygon",
      points: square(900, 0, 50),
    });
    const kept = intoGroup(toggleLocked(target.document, id), after.document, id);
    assert.equal(kept.shapes.get(after.shape.id)?.groupId, null);
  });
});

describe("group by", () => {
  test("class makes one group per class, coloured like the class", () => {
    let { doc } = drawn(2, { classKey: "tumor" });
    doc = addShape(doc, {
      kind: "polygon",
      points: square(0, 500, 50),
      classKey: "immune",
    }).document;
    doc = addShape(doc, { kind: "polygon", points: square(0, 600, 50) }).document;
    const grouped = groupBy(doc, "class", context);
    const rows = layerRows(grouped, context).map((row) => [row.name, row.count]);
    assert.deepEqual(rows, [
      ["Tumor", 2],
      ["Immune", 1],
      ["No class", 1],
    ]);
    assert.deepEqual(grouped.groups.get(1)?.color, [248, 113, 113]);
  });

  test("shapes in groups you made are left alone", () => {
    const { doc, ids } = drawn(3, { classKey: "tumor" });
    const own = groupShapes(doc, [ids[0] ?? 0], "Mine");
    assert.ok(own);
    const grouped = groupBy(own.document, "class", context);
    assert.equal(grouped.shapes.get(ids[0] ?? 0)?.groupId, own.group.id);
    assert.equal(layerRows(grouped, context).find((row) => row.name === "Tumor")?.count, 2);
  });

  test("running it again folds new shapes into the same groups", () => {
    const { doc } = drawn(2, { classKey: "tumor" });
    const first = groupBy(doc, "class", context);
    const more = addShape(first, {
      kind: "polygon",
      points: square(0, 500, 50),
      classKey: "tumor",
    }).document;
    const second = groupBy(more, "class", context);
    assert.equal(second.groups.size, 1);
    assert.equal(layerRows(second, context)[0]?.count, 3);
  });

  test("source tells hand-drawn shapes from model ones", () => {
    const { doc } = drawn(2);
    assert.deepEqual(
      bucketsOf(doc, "source", context).map((bucket) => [bucket.name, bucket.ids.length]),
      [["Drawn by hand", 2]],
    );
  });

  test("region puts a shape in the area its centre is in", () => {
    let { doc } = drawn(1);
    doc = addShape(doc, { kind: "polygon", points: square(5000, 5000, 50) }).document;
    assert.deepEqual(
      bucketsOf(doc, "region", context).map((bucket) => [bucket.name, bucket.ids.length]),
      [
        ["T1", 1],
        ["Outside the areas", 1],
      ],
    );
  });

  test("cluster joins shapes that are close and splits the far ones, largest first", () => {
    let doc = createDocument();
    for (const [x, y] of [
      [0, 0],
      [150, 0],
      [300, 0],
      [5000, 5000],
    ] as const) {
      doc = addShape(doc, { kind: "polygon", points: square(x, y, 50) }).document;
    }
    assert.deepEqual(
      bucketsOf(doc, "cluster", context).map((bucket) => [bucket.name, bucket.ids.length]),
      [
        ["Cluster 1", 3],
        ["Cluster 2", 1],
      ],
    );
  });
});

describe("overlays and colours", () => {
  test("A hides every top group and a second A shows them again", () => {
    const { doc, ids } = drawn(2);
    const a = groupShapes(doc, [ids[0] ?? 0], "A");
    assert.ok(a);
    const b = groupShapes(a.document, [ids[1] ?? 0], "B");
    assert.ok(b);
    const off = setOverlaysHidden(b.document, true);
    assert.equal(overlaysHidden(off), true);
    assert.equal(pickShape(off, { x: 50, y: 50 }, 4), null);
    const on = setOverlaysHidden(off, false);
    assert.equal(overlaysHidden(on), false);
    assert.equal(pickShape(on, { x: 50, y: 50 }, 4)?.id, ids[0]);
  });

  test("A also hides shapes that sit in no group", () => {
    const { doc } = drawn(2);
    const off = setOverlaysHidden(doc, true);
    assert.equal(pickShape(off, { x: 50, y: 50 }, 4), null);
    assert.equal(overlaysHidden(off), true);
    assert.equal(pickShape(setOverlaysHidden(off, false), { x: 50, y: 50 }, 4)?.id, 1);
  });

  test("a hex colour converts to a group colour and back", () => {
    assert.deepEqual(rgbOfHex("#f87171"), [248, 113, 113]);
    assert.equal(rgbOfHex("var(--c-tumor)"), null);
    assert.equal(hexOfRgb([248, 113, 113]), "#f87171");
    assert.equal(hexOfRgb(null), "#888888");
  });
});
