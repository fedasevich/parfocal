import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  type AnnotationDocument,
  addGroup,
  addRun,
  addShape,
  createDocument,
  promoteRunPiece,
  updateGroup,
} from "../src/annotations/document.ts";
import { runFromProposals } from "../src/annotations/runs.ts";
import { createSelectTool, type SelectTool } from "../src/annotations/select-tool.ts";
import { at, type ShapeId } from "../src/annotations/shapes.ts";
import type {
  TraceDoubleClickEvent,
  TraceEvent,
  TracePointerEvent,
} from "../src/screens/input-traces/trace-format.ts";

type Modifiers = { shiftKey?: boolean };

const none = { ctrlKey: false, shiftKey: false, altKey: false, metaKey: false };

function pointer(
  type: TracePointerEvent["type"],
  x: number,
  y: number,
  modifiers: Modifiers = {},
): TracePointerEvent {
  return {
    type,
    t: 0,
    clientX: x,
    clientY: y,
    pointerId: 1,
    pointerType: "mouse",
    button: 0,
    buttons: type === "pointerup" ? 0 : 1,
    ...none,
    ...modifiers,
  };
}

function doubleClick(x: number, y: number): TraceDoubleClickEvent {
  return { type: "dblclick", t: 0, clientX: x, clientY: y, button: 0, ...none };
}

function drag(
  from: readonly [number, number],
  to: readonly [number, number],
  modifiers: Modifiers = {},
  steps = 4,
): TraceEvent[] {
  const events: TraceEvent[] = [pointer("pointerdown", from[0], from[1], modifiers)];
  for (let step = 1; step <= steps; step++) {
    const x = from[0] + ((to[0] - from[0]) * step) / steps;
    const y = from[1] + ((to[1] - from[1]) * step) / steps;
    events.push(pointer("pointermove", x, y, modifiers));
  }
  events.push(pointer("pointerup", to[0], to[1], modifiers));
  return events;
}

function click(x: number, y: number, modifiers: Modifiers = {}): TraceEvent[] {
  return [pointer("pointerdown", x, y, modifiers), pointer("pointerup", x, y, modifiers)];
}

function viewerInput(event: TraceEvent) {
  if (event.type === "wheel") throw new Error("a select gesture has no wheel");
  if (event.type === "dblclick") {
    return { kind: "dblclick" as const, ...event };
  }
  const kind = {
    pointerdown: "down",
    pointermove: "move",
    pointerup: "up",
    pointercancel: "cancel",
  } as const;
  return { ...event, kind: kind[event.type] };
}

interface Rig {
  readonly tool: SelectTool;
  readonly doc: () => AnnotationDocument;
  readonly commits: string[];
  readonly replay: (events: readonly TraceEvent[]) => boolean[];
  readonly ids: () => readonly ShapeId[];
}

function rig(setup: (doc: AnnotationDocument) => AnnotationDocument, pixelSize = 1): Rig {
  let doc = setup(createDocument());
  const commits: string[] = [];
  const tool = createSelectTool({
    document: () => doc,
    setDocument: (next) => {
      doc = next;
    },
    toSlide: (point) => ({ x: point.clientX, y: point.clientY }),
    pixelSize: () => pixelSize,
    commit: (_before, _after, label) => commits.push(label),
  });
  return {
    tool,
    doc: () => doc,
    commits,
    replay: (events) => events.map((event) => tool.handle(viewerInput(event))),
    ids: () => tool.state().ids,
  };
}

function square(x: number, y: number, size: number) {
  return Float32Array.of(x, y, x + size, y, x + size, y + size, x, y + size);
}

function twoSquares(doc: AnnotationDocument) {
  const first = addShape(doc, { kind: "polygon", points: square(100, 100, 200) });
  const second = addShape(first.document, { kind: "polygon", points: square(500, 100, 100) });
  return second.document;
}

function pointsOf(doc: AnnotationDocument, id: ShapeId): number[] {
  return [...(doc.shapes.get(id)?.points ?? [])];
}

describe("select tool click", () => {
  test("a click on a shape selects it and a click on empty space clears the selection", () => {
    const r = rig(twoSquares);
    r.replay(click(200, 200));
    assert.deepEqual(r.ids(), [1]);
    r.replay(click(550, 150));
    assert.deepEqual(r.ids(), [2]);
    r.replay(click(900, 900));
    assert.deepEqual(r.ids(), []);
  });

  test("a click on an outline selects the shape even outside its fill", () => {
    const r = rig(twoSquares);
    r.replay(click(97, 200));
    assert.deepEqual(r.ids(), [1]);
  });

  test("the outline tolerance follows the pixel size so it stays six screen pixels at any zoom", () => {
    const zoomedOut = rig(twoSquares, 10);
    zoomedOut.replay(click(50, 200));
    assert.deepEqual(zoomedOut.ids(), [1]);
    const zoomedIn = rig(twoSquares, 0.1);
    zoomedIn.replay(click(97, 200));
    assert.deepEqual(zoomedIn.ids(), []);
  });

  test("the topmost shape wins where two overlap", () => {
    const r = rig((doc) => {
      const bottom = addShape(doc, { kind: "polygon", points: square(100, 100, 200) });
      return addShape(bottom.document, { kind: "polygon", points: square(150, 150, 50) }).document;
    });
    r.replay(click(170, 170));
    assert.deepEqual(r.ids(), [2]);
  });

  test("a click on a multi-selection without moving collapses it to that shape", () => {
    const r = rig(twoSquares);
    r.tool.select([1, 2]);
    r.replay(click(200, 200));
    assert.deepEqual(r.ids(), [1]);
  });

  test("a press with another mouse button is left to the camera", () => {
    const r = rig(twoSquares);
    const event = { ...pointer("pointerdown", 200, 200), button: 1 };
    assert.equal(r.tool.handle(viewerInput(event)), false);
    assert.deepEqual(r.ids(), []);
  });

  test("hidden and locked shapes are not selectable", () => {
    const r = rig((doc) => {
      const withGroup = addGroup(doc, "Locked");
      const locked = updateGroup(withGroup.document, withGroup.group.id, { locked: true });
      return addShape(locked.document, {
        kind: "polygon",
        points: square(100, 100, 200),
        groupId: withGroup.group.id,
      }).document;
    });
    r.replay(click(200, 200));
    assert.deepEqual(r.ids(), []);
  });
});

describe("select tool shift click", () => {
  test("Shift plus click adds a shape and a second Shift click removes it", () => {
    const r = rig(twoSquares);
    r.replay(click(200, 200));
    r.replay(click(550, 150, { shiftKey: true }));
    assert.deepEqual(r.ids(), [1, 2]);
    r.replay(click(550, 150, { shiftKey: true }));
    assert.deepEqual(r.ids(), [1]);
  });

  test("Shift plus click toggles only when the pointer moved less than three pixels", () => {
    const small = rig(twoSquares);
    small.replay([
      pointer("pointerdown", 550, 150, { shiftKey: true }),
      pointer("pointermove", 552, 151, { shiftKey: true }),
      pointer("pointerup", 552, 151, { shiftKey: true }),
    ]);
    assert.deepEqual(small.ids(), [2]);

    const large = rig(twoSquares);
    large.replay([
      pointer("pointerdown", 550, 150, { shiftKey: true }),
      pointer("pointermove", 554, 150, { shiftKey: true }),
      pointer("pointerup", 554, 150, { shiftKey: true }),
    ]);
    assert.deepEqual(large.ids(), [2]);
    assert.deepEqual(
      pointsOf(large.doc(), 2).slice(0, 2),
      [504, 100],
      "a dragged press moves the shape instead",
    );
  });

  test("Shift plus click on empty space keeps the selection", () => {
    const r = rig(twoSquares);
    r.replay(click(200, 200));
    r.replay(click(900, 900, { shiftKey: true }));
    assert.deepEqual(r.ids(), [1]);
  });
});

describe("select tool marquee", () => {
  test("a drag on empty space selects every shape the box touches, live", () => {
    const r = rig(twoSquares);
    const events = drag([50, 50], [550, 250]);
    r.replay(events.slice(0, 3));
    assert.equal(r.tool.state().gesture, "marquee");
    assert.deepEqual(r.tool.state().marquee, [50, 50, 300, 150]);
    assert.deepEqual(r.ids(), [1]);
    r.replay(events.slice(3));
    assert.deepEqual(r.ids(), [1, 2]);
    assert.equal(r.tool.state().marquee, null);
    assert.equal(r.tool.state().gesture, "idle");
    assert.deepEqual(r.commits, []);
  });

  test("a marquee dragged from any corner selects the same shapes", () => {
    const r = rig(twoSquares);
    r.replay(drag([650, 300], [450, 50]));
    assert.deepEqual(r.ids(), [2]);
  });

  test("Shift plus marquee adds to the selection", () => {
    const r = rig(twoSquares);
    r.replay(click(200, 200));
    r.replay(drag([450, 50], [650, 250], { shiftKey: true }));
    assert.deepEqual(r.ids(), [1, 2]);
  });

  test("a marquee over nothing leaves an empty selection", () => {
    const r = rig(twoSquares);
    r.replay(click(200, 200));
    r.replay(drag([700, 500], [900, 700]));
    assert.deepEqual(r.ids(), []);
  });

  test("Escape during a marquee restores the earlier selection", () => {
    const r = rig(twoSquares);
    r.replay(click(200, 200));
    r.replay(drag([450, 50], [650, 250]).slice(0, 3));
    assert.deepEqual(r.ids(), [2]);
    assert.equal(r.tool.cancel(), true);
    assert.deepEqual(r.ids(), [1]);
    assert.equal(r.tool.cancel(), false);
  });
});

describe("select tool move", () => {
  test("a drag from a shape moves it and commits one step", () => {
    const r = rig(twoSquares);
    r.replay(drag([200, 200], [260, 230]));
    assert.deepEqual(pointsOf(r.doc(), 1).slice(0, 2), [160, 130]);
    assert.deepEqual(r.ids(), [1]);
    assert.deepEqual(r.commits, ["Move"]);
  });

  test("a drag under three pixels does not move anything", () => {
    const r = rig(twoSquares);
    r.replay([
      pointer("pointerdown", 200, 200),
      pointer("pointermove", 202, 201),
      pointer("pointerup", 202, 201),
    ]);
    assert.deepEqual(pointsOf(r.doc(), 1).slice(0, 2), [100, 100]);
    assert.deepEqual(r.commits, []);
  });

  test("a drag moves every selected shape together", () => {
    const r = rig(twoSquares);
    r.tool.select([1, 2]);
    r.replay(drag([200, 200], [220, 240]));
    assert.deepEqual(pointsOf(r.doc(), 1).slice(0, 2), [120, 140]);
    assert.deepEqual(pointsOf(r.doc(), 2).slice(0, 2), [520, 140]);
    assert.deepEqual(r.ids(), [1, 2]);
    assert.deepEqual(r.commits, ["Move"]);
  });

  test("Shift locks the move to the dominant axis", () => {
    const horizontal = rig(twoSquares);
    horizontal.replay(drag([200, 200], [280, 215], { shiftKey: true }));
    assert.deepEqual(pointsOf(horizontal.doc(), 1).slice(0, 2), [180, 100]);

    const vertical = rig(twoSquares);
    vertical.replay(drag([200, 200], [212, 290], { shiftKey: true }));
    assert.deepEqual(pointsOf(vertical.doc(), 1).slice(0, 2), [100, 190]);
  });

  test("Escape in the middle of a move puts the shape back", () => {
    const r = rig(twoSquares);
    r.replay(drag([200, 200], [300, 300]).slice(0, 3));
    assert.notDeepEqual(pointsOf(r.doc(), 1).slice(0, 2), [100, 100]);
    assert.equal(r.tool.cancel(), true);
    assert.deepEqual(pointsOf(r.doc(), 1).slice(0, 2), [100, 100]);
    assert.deepEqual(r.commits, []);
    assert.equal(r.tool.state().gesture, "idle");
  });

  test("a cancelled pointer puts the shape back", () => {
    const r = rig(twoSquares);
    r.replay([...drag([200, 200], [300, 300]).slice(0, 3), pointer("pointercancel", 250, 250)]);
    assert.deepEqual(pointsOf(r.doc(), 1).slice(0, 2), [100, 100]);
  });

  test("moving a model proposal marks it edited", () => {
    const r = rig((doc) => {
      const run = runFromProposals({ id: 1, model: "m" }, [
        { points: square(100, 100, 200), confidence: 0.9 },
      ]);
      return promoteRunPiece(addRun(doc, run), 1, 0).document;
    });
    r.replay(drag([200, 200], [240, 200]));
    const provenance = r.doc().shapes.get(1)?.provenance;
    assert.equal(provenance?.kind === "model" && provenance.edited, true);
  });
});

describe("select tool vertex reshape", () => {
  function selectedSquare() {
    const r = rig(twoSquares);
    r.replay(click(200, 200));
    return r;
  }

  test("dragging a vertex of the selected shape moves only that vertex", () => {
    const r = selectedSquare();
    r.replay(drag([300, 300], [340, 360]));
    assert.deepEqual(pointsOf(r.doc(), 1), [100, 100, 300, 100, 340, 360, 100, 300]);
    assert.deepEqual(r.commits, ["Reshape"]);
  });

  test("a vertex is grabbed within eight screen pixels", () => {
    const r = selectedSquare();
    r.replay(drag([305, 305], [340, 360]));
    assert.deepEqual(pointsOf(r.doc(), 1).slice(4, 6), [340, 360]);
  });

  test("Shift snaps the segment from the neighbouring vertex to a multiple of 45 degrees", () => {
    const r = selectedSquare();
    r.replay(drag([300, 300], [380, 372], { shiftKey: true }));
    const moved = Float32Array.from(pointsOf(r.doc(), 1));
    const x = at(moved, 4);
    const y = at(moved, 5);
    const angle = (Math.atan2(y - 100, x - 300) * 180) / Math.PI;
    assert.ok(Math.abs(angle / 45 - Math.round(angle / 45)) < 1e-3, `angle ${angle}`);
  });

  test("a vertex of an unselected shape is a plain press that selects and moves it", () => {
    const r = rig(twoSquares);
    r.replay(drag([300, 300], [310, 310]));
    assert.deepEqual(pointsOf(r.doc(), 1).slice(0, 2), [110, 110]);
  });

  test("a rectangle reshapes by its corners and keeps the opposite corner", () => {
    const r = rig(
      (doc) =>
        addShape(doc, { kind: "rectangle", points: Float32Array.of(100, 100, 300, 250) }).document,
    );
    r.replay(click(200, 180));
    r.replay(drag([300, 250], [400, 400]));
    assert.deepEqual(pointsOf(r.doc(), 1), [100, 100, 400, 400]);
  });

  test("Escape in the middle of a reshape restores the vertex", () => {
    const r = selectedSquare();
    r.replay(drag([300, 300], [340, 360]).slice(0, 3));
    r.tool.cancel();
    assert.deepEqual(pointsOf(r.doc(), 1), [100, 100, 300, 100, 300, 300, 100, 300]);
    assert.deepEqual(r.ids(), [1]);
  });
});

describe("select tool edge reshape", () => {
  function selectedSquare() {
    const r = rig(twoSquares);
    r.replay(click(200, 200));
    return r;
  }

  test("dragging an edge of the selected shape moves both of its vertices", () => {
    const r = selectedSquare();
    r.replay(drag([200, 100], [200, 60]));
    assert.deepEqual(pointsOf(r.doc(), 1), [100, 60, 300, 60, 300, 300, 100, 300]);
    assert.deepEqual(r.commits, ["Reshape"]);
  });

  test("Shift snaps the direction of an edge drag to a multiple of 45 degrees", () => {
    const r = selectedSquare();
    r.replay(drag([200, 100], [260, 70], { shiftKey: true }));
    const [x0, y0, x1, y1] = pointsOf(r.doc(), 1);
    assert.ok(x0 !== undefined && y0 !== undefined && x1 !== undefined && y1 !== undefined);
    const dx = x0 - 100;
    const dy = y0 - 100;
    assert.ok(Math.abs(dx) > 0 || Math.abs(dy) > 0);
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    assert.ok(Math.abs(angle / 45 - Math.round(angle / 45)) < 1e-3, `angle ${angle}`);
    assert.ok(Math.abs(x1 - x0 - 200) < 0.01);
  });
});

describe("select tool double click", () => {
  function selectedSquare() {
    const r = rig(twoSquares);
    r.replay(click(200, 200));
    return r;
  }

  test("double-clicking an edge adds a point where it was clicked", () => {
    const r = selectedSquare();
    r.replay([...click(220, 100), doubleClick(220, 100)]);
    assert.deepEqual(pointsOf(r.doc(), 1), [100, 100, 220, 100, 300, 100, 300, 300, 100, 300]);
    assert.deepEqual(r.commits, ["Add point"]);
  });

  test("a point added on the closing edge lands after the last vertex", () => {
    const r = selectedSquare();
    r.replay([...click(100, 200), doubleClick(100, 200)]);
    assert.deepEqual(pointsOf(r.doc(), 1), [100, 100, 300, 100, 300, 300, 100, 300, 100, 200]);
  });

  test("double-clicking a point removes it", () => {
    const r = selectedSquare();
    r.replay([...click(220, 100), doubleClick(220, 100)]);
    r.replay([...click(220, 100), doubleClick(220, 100)]);
    assert.deepEqual(pointsOf(r.doc(), 1), [100, 100, 300, 100, 300, 300, 100, 300]);
    assert.deepEqual(r.commits, ["Add point", "Remove point"]);
  });

  test("a triangle keeps its three points", () => {
    const r = rig(
      (doc) =>
        addShape(doc, { kind: "polygon", points: Float32Array.of(100, 100, 300, 100, 200, 300) })
          .document,
    );
    r.replay(click(200, 150));
    const events = [...click(300, 100), doubleClick(300, 100)];
    const consumed = r.replay(events);
    assert.equal(consumed.at(-1), true);
    assert.equal(pointsOf(r.doc(), 1).length, 6);
    assert.deepEqual(r.commits, []);
  });

  test("a ruler has two points and takes no more", () => {
    const r = rig(
      (doc) =>
        addShape(doc, { kind: "ruler", points: Float32Array.of(100, 100, 400, 100) }).document,
    );
    r.replay(click(250, 100));
    r.replay([doubleClick(250, 100)]);
    assert.equal(pointsOf(r.doc(), 1).length, 4);
  });

  test("a double click on a shape is kept from zooming and on empty space is left to the camera", () => {
    const r = rig(twoSquares);
    assert.equal(r.tool.handle(viewerInput(doubleClick(200, 200))), true);
    assert.equal(r.tool.handle(viewerInput(doubleClick(900, 900))), false);
  });
});

describe("select tool state", () => {
  test("subscribers hear every selection change", () => {
    const r = rig(twoSquares);
    let heard = 0;
    const stop = r.tool.subscribe(() => {
      heard += 1;
    });
    r.replay(click(200, 200));
    assert.ok(heard > 0);
    stop();
    const before = heard;
    r.replay(click(550, 150));
    assert.equal(heard, before);
  });

  test("pruning drops ids that left the document", () => {
    const r = rig(twoSquares);
    r.tool.select([1, 2, 7]);
    r.tool.prune();
    assert.deepEqual(r.ids(), [1, 2]);
  });
});
