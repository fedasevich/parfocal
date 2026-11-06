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
  updateShape,
} from "../src/annotations/document.ts";
import { runFromProposals } from "../src/annotations/runs.ts";
import { createSelectTool, type SelectTool } from "../src/annotations/select-tool.ts";
import { at, type ShapeId } from "../src/annotations/shapes.ts";
import type {
  TraceDoubleClickEvent,
  TraceEvent,
  TracePointerEvent,
} from "../src/screens/input-traces/trace-format.ts";
import { screenScale, screenToSlide, slideToScreen } from "../src/viewer/viewer-engine.ts";

type Modifiers = { shiftKey?: boolean; altKey?: boolean };

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

  test("a vertex grabbed within eight screen pixels keeps its grab offset instead of jumping", () => {
    const r = selectedSquare();
    r.replay(drag([305, 305], [340, 360]));
    assert.deepEqual(pointsOf(r.doc(), 1).slice(4, 6), [335, 355]);
  });

  test("a vertex grabbed off centre with Shift snaps the carried point, not the pointer", () => {
    const r = selectedSquare();
    r.replay(drag([304, 303], [304, 403], { shiftKey: true }));
    assert.deepEqual(pointsOf(r.doc(), 1).slice(4, 6), [300, 400]);
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

  test("a rectangle corner grabbed off centre keeps its grab offset", () => {
    const r = rig(
      (doc) =>
        addShape(doc, { kind: "rectangle", points: Float32Array.of(100, 100, 300, 250) }).document,
    );
    r.replay(click(200, 180));
    r.replay(drag([305, 255], [405, 405]));
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
    assert.equal(r.tool.state().editing, 1);
    assert.equal(r.tool.handle(viewerInput(doubleClick(900, 900))), true);
    assert.equal(r.tool.state().editing, null);
    assert.equal(r.tool.handle(viewerInput(doubleClick(900, 900))), false);
  });
});

describe("select tool point editing", () => {
  function editingSquare() {
    const r = rig(twoSquares);
    r.replay(click(200, 200));
    assert.equal(r.tool.edit(1), true);
    return r;
  }

  test("Enter style entry needs a sole reshapable selectable shape", () => {
    const r = rig(twoSquares);
    assert.equal(r.tool.edit(1), true);
    assert.deepEqual(r.ids(), [1]);
    assert.equal(r.tool.state().editing, 1);
    assert.equal(r.tool.edit(99), false);
    const marks = rig(
      (doc) => addShape(doc, { kind: "point", points: Float32Array.of(50, 50) }).document,
    );
    assert.equal(marks.tool.edit(1), false);
  });

  test("leaving edit mode keeps the shape selected and drops the vertex selection", () => {
    const r = editingSquare();
    r.replay(click(300, 300));
    assert.deepEqual(r.tool.state().vertices, [2]);
    assert.equal(r.tool.edit(null), true);
    assert.equal(r.tool.state().editing, null);
    assert.deepEqual(r.tool.state().vertices, []);
    assert.deepEqual(r.ids(), [1]);
    assert.equal(r.tool.edit(null), false);
  });

  test("a click on a vertex selects it and Shift click adds and removes vertices", () => {
    const r = editingSquare();
    r.replay(click(300, 300));
    assert.deepEqual(r.tool.state().vertices, [2]);
    r.replay(click(100, 100, { shiftKey: true }));
    assert.deepEqual(r.tool.state().vertices, [0, 2]);
    r.replay(click(300, 300, { shiftKey: true }));
    assert.deepEqual(r.tool.state().vertices, [0]);
    r.replay(click(300, 100));
    assert.deepEqual(r.tool.state().vertices, [1]);
  });

  test("a marquee in edit mode selects the vertices inside it and a click on empty clears them", () => {
    const r = editingSquare();
    r.replay(drag([250, 50], [350, 350]));
    assert.deepEqual(r.tool.state().vertices, [1, 2]);
    assert.deepEqual(r.ids(), [1]);
    r.replay(drag([50, 250], [150, 350], { shiftKey: true }));
    assert.deepEqual(r.tool.state().vertices, [1, 2, 3]);
    r.replay(click(900, 900));
    assert.deepEqual(r.tool.state().vertices, []);
    assert.equal(r.tool.state().editing, 1);
  });

  test("dragging a selected vertex moves every selected vertex together in one commit", () => {
    const r = editingSquare();
    r.replay(drag([250, 50], [350, 350]));
    r.replay(drag([300, 300], [320, 340]));
    assert.deepEqual(pointsOf(r.doc(), 1), [100, 100, 320, 140, 320, 340, 100, 300]);
    assert.deepEqual(r.commits, ["Reshape"]);
  });

  test("dragging an unselected vertex selects only it and moves only it", () => {
    const r = editingSquare();
    r.replay(drag([250, 50], [350, 350]));
    r.replay(drag([100, 100], [90, 80]));
    assert.deepEqual(r.tool.state().vertices, [0]);
    assert.deepEqual(pointsOf(r.doc(), 1), [90, 80, 300, 100, 300, 300, 100, 300]);
  });

  test("arrow nudges move the selected vertices by one screen pixel, ten with Shift", () => {
    const r = editingSquare();
    r.replay(drag([250, 50], [350, 350]));
    assert.equal(r.tool.nudge(1, 0), true);
    assert.equal(r.tool.nudge(0, 10), true);
    assert.deepEqual(pointsOf(r.doc(), 1), [100, 100, 301, 110, 301, 310, 100, 300]);
    assert.deepEqual(r.commits, ["Nudge", "Nudge"]);
    r.replay(click(900, 900));
    assert.equal(r.tool.nudge(1, 0), false);
  });

  test("nudges scale with the pixel size so a step is always one screen pixel", () => {
    const r = rig(twoSquares, 4);
    r.replay(click(200, 200));
    r.tool.edit(1);
    r.replay(click(300, 300));
    r.tool.nudge(1, 0);
    assert.deepEqual(pointsOf(r.doc(), 1).slice(4, 6), [304, 300]);
  });

  test("Delete removes the selected vertices but never below three for a polygon", () => {
    const r = rig(
      (doc) =>
        addShape(doc, {
          kind: "polygon",
          points: Float32Array.of(0, 0, 100, 0, 100, 100, 50, 150, 0, 100),
        }).document,
    );
    r.replay(click(50, 50));
    r.tool.edit(1);
    r.replay(click(100, 100, { shiftKey: true }));
    r.replay(click(50, 150, { shiftKey: true }));
    assert.deepEqual(r.tool.state().vertices, [2, 3]);
    assert.equal(r.tool.removeSelected(), true);
    assert.deepEqual(pointsOf(r.doc(), 1), [0, 0, 100, 0, 0, 100]);
    assert.deepEqual(r.commits, ["Remove points"]);
    r.replay(click(100, 0));
    assert.equal(r.tool.removeSelected(), false);
    assert.deepEqual(pointsOf(r.doc(), 1), [0, 0, 100, 0, 0, 100]);
    assert.equal(r.tool.state().editing, 1);
  });

  test("Alt click on a vertex removes it without starting a drag", () => {
    const r = editingSquare();
    r.replay(click(300, 300, { altKey: true }));
    assert.deepEqual(pointsOf(r.doc(), 1), [100, 100, 300, 100, 100, 300]);
    assert.deepEqual(r.commits, ["Remove point"]);
    assert.equal(r.tool.state().gesture, "idle");
    r.replay(click(300, 100, { altKey: true }));
    assert.deepEqual(pointsOf(r.doc(), 1), [100, 100, 300, 100, 100, 300]);
  });

  test("hovering an edge shows a midpoint and dragging it inserts a point in one commit", () => {
    const r = editingSquare();
    r.replay([pointer("pointermove", 200, 100)]);
    const hover = r.tool.state().hover;
    assert.equal(hover?.kind, "midpoint");
    assert.deepEqual(hover?.kind === "midpoint" ? hover.at : null, { x: 200, y: 100 });
    r.replay(drag([201, 101], [220, 60]));
    assert.deepEqual(pointsOf(r.doc(), 1), [100, 100, 219, 59, 300, 100, 300, 300, 100, 300]);
    assert.deepEqual(r.tool.state().vertices, [1]);
    assert.deepEqual(r.commits, ["Add point"]);
  });

  test("Escape in the middle of a midpoint drag takes the new point away again", () => {
    const r = editingSquare();
    r.replay(drag([200, 100], [220, 60]).slice(0, 3));
    assert.equal(pointsOf(r.doc(), 1).length, 10);
    r.tool.cancel();
    assert.deepEqual(pointsOf(r.doc(), 1), [100, 100, 300, 100, 300, 300, 100, 300]);
    assert.deepEqual(r.tool.state().vertices, []);
    assert.deepEqual(r.commits, []);
  });

  test("a handle is grabbed from a wider ring than it is drawn, wider still for touch", () => {
    const r = rig(twoSquares);
    r.replay(click(200, 200));
    r.replay([pointer("pointermove", 308, 308)]);
    assert.equal(r.tool.state().hover?.kind, "vertex");
    r.replay([pointer("pointermove", 314, 314)]);
    assert.notEqual(r.tool.state().hover?.kind, "vertex");
    r.replay([{ ...pointer("pointermove", 314, 314), pointerType: "touch" }]);
    assert.equal(r.tool.state().hover?.kind, "vertex");
    r.replay(drag([308, 308], [348, 348]));
    assert.deepEqual(pointsOf(r.doc(), 1), [100, 100, 300, 100, 340, 340, 100, 300]);
  });

  test("on a tiny shape the handle ring shrinks so the body still moves the shape", () => {
    const r = rig(
      (doc) => addShape(doc, { kind: "polygon", points: square(100, 100, 20) }).document,
    );
    r.replay(click(110, 110));
    r.replay([pointer("pointermove", 110, 110)]);
    assert.notEqual(r.tool.state().hover?.kind, "vertex");
    r.replay([pointer("pointermove", 126, 126)]);
    assert.equal(r.tool.state().hover?.kind, "vertex");
  });

  test("the midpoint is only offered in edit mode and edge hover reports the edge otherwise", () => {
    const r = rig(twoSquares);
    r.replay(click(200, 200));
    r.replay([pointer("pointermove", 200, 100)]);
    assert.equal(r.tool.state().hover?.kind, "edge");
    r.replay([pointer("pointermove", 300, 300)]);
    assert.equal(r.tool.state().hover?.kind, "vertex");
    r.replay([pointer("pointermove", 550, 150)]);
    assert.deepEqual(r.tool.state().hover, { kind: "shape", id: 2 });
    r.replay([pointer("pointermove", 900, 900)]);
    assert.equal(r.tool.state().hover, null);
  });

  test("select all in edit mode selects every vertex", () => {
    const r = editingSquare();
    r.tool.selectAll();
    assert.deepEqual(r.tool.state().vertices, [0, 1, 2, 3]);
  });

  test("pressing another shape leaves edit mode and selects that shape", () => {
    const r = editingSquare();
    r.replay(click(550, 150));
    assert.equal(r.tool.state().editing, null);
    assert.deepEqual(r.ids(), [2]);
  });

  test("a double click on an edge in edit mode adds a point and on a vertex removes it", () => {
    const r = editingSquare();
    r.replay([viewerInput(doubleClick(200, 100))].map(() => doubleClick(200, 100)));
    assert.deepEqual(pointsOf(r.doc(), 1), [100, 100, 200, 100, 300, 100, 300, 300, 100, 300]);
    assert.deepEqual(r.tool.state().vertices, [1]);
    r.replay([doubleClick(200, 100)]);
    assert.deepEqual(pointsOf(r.doc(), 1), [100, 100, 300, 100, 300, 300, 100, 300]);
  });

  test("pruning after an undo drops vertices that no longer exist and leaves edit mode when the shape went", () => {
    const r = editingSquare();
    r.tool.selectAll();
    const smaller = updateShape(r.doc(), 1, {
      geometry: { points: Float32Array.of(0, 0, 10, 0, 0, 10), ringStarts: Uint32Array.of(0, 3) },
    }).document;
    r.tool.prune(smaller);
    assert.deepEqual(r.tool.state().vertices, [0, 1, 2]);
    r.tool.prune(createDocument());
    assert.equal(r.tool.state().editing, null);
    assert.deepEqual(r.ids(), []);
  });
});

describe("select tool with several shapes", () => {
  function bothSelected() {
    const r = rig(twoSquares);
    r.tool.selectAll();
    assert.deepEqual(r.ids(), [1, 2]);
    return r;
  }

  test("Delete removes every selected shape in one commit and clears the selection", () => {
    const r = bothSelected();
    assert.equal(r.tool.removeSelected(), true);
    assert.equal(r.doc().shapes.size, 0);
    assert.deepEqual(r.ids(), []);
    assert.deepEqual(r.commits, ["Delete"]);
    assert.equal(r.tool.removeSelected(), false);
  });

  test("arrow nudges move every selected shape by one screen pixel, ten with Shift", () => {
    const r = bothSelected();
    r.tool.nudge(-1, 0);
    r.tool.nudge(0, 10);
    assert.deepEqual(pointsOf(r.doc(), 1).slice(0, 2), [99, 110]);
    assert.deepEqual(pointsOf(r.doc(), 2).slice(0, 2), [499, 110]);
    assert.deepEqual(r.commits, ["Nudge", "Nudge"]);
  });

  test("a drag from one selected shape moves both and Shift locks the axis", () => {
    const r = bothSelected();
    r.replay(drag([550, 150], [580, 210], { shiftKey: true }));
    assert.deepEqual(pointsOf(r.doc(), 1).slice(0, 2), [100, 160]);
    assert.deepEqual(pointsOf(r.doc(), 2).slice(0, 2), [500, 160]);
    assert.deepEqual(r.commits, ["Move"]);
  });

  test("Alt drag duplicates the selection and moves the copies in one commit", () => {
    const r = bothSelected();
    r.replay(
      drag([200, 200], [240, 200], {}, 4).map((event) =>
        event.type === "dblclick" || event.type === "wheel" ? event : { ...event, altKey: true },
      ),
    );
    assert.equal(r.doc().shapes.size, 4);
    assert.deepEqual(r.ids(), [3, 4]);
    assert.deepEqual(pointsOf(r.doc(), 1).slice(0, 2), [100, 100]);
    assert.deepEqual(pointsOf(r.doc(), 3).slice(0, 2), [140, 100]);
    assert.deepEqual(pointsOf(r.doc(), 4).slice(0, 2), [540, 100]);
    assert.deepEqual(r.commits, ["Duplicate"]);
  });

  test("Escape during an Alt drag removes the copies again", () => {
    const r = bothSelected();
    const events = drag([200, 200], [240, 200])
      .slice(0, 3)
      .map((event) => ({ ...event, altKey: true }));
    r.replay(events);
    assert.equal(r.doc().shapes.size, 4);
    r.tool.cancel();
    assert.equal(r.doc().shapes.size, 2);
    assert.deepEqual(r.ids(), [1, 2]);
  });

  test("select all skips hidden and locked shapes", () => {
    const r = rig((doc) => {
      const two = twoSquares(doc);
      const group = addGroup(two, "hidden");
      const grouped = updateShape(group.document, 2, { groupId: group.group.id }).document;
      return updateGroup(grouped, group.group.id, { hidden: true }).document;
    });
    r.tool.selectAll();
    assert.deepEqual(r.ids(), [1]);
  });

  test("markers and text are picked within twelve screen pixels and move with the others", () => {
    const r = rig((doc) => {
      const marker = addShape(twoSquares(doc), {
        kind: "point",
        points: Float32Array.of(700, 700),
      });
      return addShape(marker.document, {
        kind: "text",
        points: Float32Array.of(800, 800),
        text: "note",
      }).document;
    });
    r.replay(click(709, 700));
    assert.deepEqual(r.ids(), [3]);
    r.replay(click(808, 808, { shiftKey: true }));
    assert.deepEqual(r.ids(), [3, 4]);
    r.replay(click(715, 700, { shiftKey: true }));
    assert.deepEqual(r.ids(), [3, 4]);
    r.replay(drag([700, 700], [710, 720]));
    assert.deepEqual(pointsOf(r.doc(), 3), [710, 720]);
    assert.deepEqual(pointsOf(r.doc(), 4), [810, 820]);
    r.replay(drag([650, 650], [850, 850]));
    assert.deepEqual(r.ids(), [3, 4]);
  });

  test("a double click on text asks the host to edit it instead of entering point editing", () => {
    const edited: number[] = [];
    let doc = addShape(createDocument(), {
      kind: "text",
      points: Float32Array.of(800, 800),
      text: "note",
    }).document;
    const tool = createSelectTool({
      document: () => doc,
      setDocument: (next) => {
        doc = next;
      },
      toSlide: (point) => ({ x: point.clientX, y: point.clientY }),
      pixelSize: () => 1,
      editText: (id) => edited.push(id),
    });
    assert.equal(tool.handle(viewerInput(doubleClick(800, 800))), true);
    assert.deepEqual(edited, [1]);
    assert.equal(tool.state().editing, null);
    assert.deepEqual(tool.state().ids, [1]);
  });

  test("a double click on an arrow enters point editing of its ends", () => {
    const r = rig(
      (doc) => addShape(doc, { kind: "arrow", points: Float32Array.of(0, 0, 100, 100) }).document,
    );
    r.replay([doubleClick(50, 50)]);
    assert.equal(r.tool.state().editing, 1);
    r.replay(drag([100, 100], [120, 130]));
    assert.deepEqual(pointsOf(r.doc(), 1), [0, 0, 120, 130]);
    assert.equal(r.tool.removeSelected(), false);
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

describe("select tool under a moving camera", () => {
  type Camera = { x: number; y: number; zoom: number };
  const view = { left: 10.5, top: 55.25, width: 800, height: 600 };

  function cameraRig(setup: (doc: AnnotationDocument) => AnnotationDocument, start: Camera) {
    let camera = start;
    let doc = setup(createDocument());
    const commits: string[] = [];
    const tool = createSelectTool({
      document: () => doc,
      setDocument: (next) => {
        doc = next;
      },
      toSlide: (point) => screenToSlide(camera, view, point.clientX, point.clientY),
      pixelSize: () => 1 / screenScale(camera),
      commit: (_before, _after, label) => commits.push(label),
    });
    const screenOf = (slide: { x: number; y: number }) => slideToScreen(camera, view, slide);
    return {
      tool,
      doc: () => doc,
      commits,
      replay: (events: readonly TraceEvent[]) =>
        events.map((event) => tool.handle(viewerInput(event))),
      ids: () => tool.state().ids,
      screenOf,
      setCamera: (next: Camera) => {
        camera = next;
      },
    };
  }

  const zooms = [-3, -1, 0, 1.5, 3.7];

  for (const zoom of zooms) {
    test(`at zoom ${zoom} a moved shape lands under the pointer`, () => {
      const r = cameraRig(twoSquares, { x: 200, y: 200, zoom });
      const grab = r.screenOf({ x: 150, y: 150 });
      const drop = { x: grab.x + 37, y: grab.y - 23 };
      r.replay(click(grab.x, grab.y));
      r.replay(drag([grab.x, grab.y], [drop.x, drop.y]));
      const moved = Float32Array.from(pointsOf(r.doc(), 1));
      const corner = r.screenOf({ x: at(moved, 0), y: at(moved, 1) });
      const expected = r.screenOf({ x: 100, y: 100 });
      assert.ok(Math.abs(corner.x - (expected.x + 37)) < 1e-3, `x ${corner.x}`);
      assert.ok(Math.abs(corner.y - (expected.y - 23)) < 1e-3, `y ${corner.y}`);
    });

    test(`at zoom ${zoom} a vertex drag keeps its grab offset in slide units`, () => {
      const r = cameraRig(twoSquares, { x: 200, y: 200, zoom });
      const vertex = r.screenOf({ x: 300, y: 300 });
      r.replay(click(r.screenOf({ x: 150, y: 150 }).x, r.screenOf({ x: 150, y: 150 }).y));
      r.replay(drag([vertex.x + 5, vertex.y + 5], [vertex.x + 45, vertex.y + 65]));
      const moved = Float32Array.from(pointsOf(r.doc(), 1));
      const landed = r.screenOf({ x: at(moved, 4), y: at(moved, 5) });
      assert.ok(Math.abs(landed.x - (vertex.x + 40)) < 1e-3, `x ${landed.x}`);
      assert.ok(Math.abs(landed.y - (vertex.y + 60)) < 1e-3, `y ${landed.y}`);
    });
  }

  test("a pan in the middle of a move keeps the shape under the pointer", () => {
    const r = cameraRig(twoSquares, { x: 200, y: 200, zoom: 0 });
    const grab = r.screenOf({ x: 150, y: 150 });
    r.replay(click(grab.x, grab.y));
    r.replay(drag([grab.x, grab.y], [grab.x + 20, grab.y]).slice(0, -1));
    r.setCamera({ x: 260, y: 170, zoom: 0 });
    r.replay([
      pointer("pointermove", grab.x + 20, grab.y),
      pointer("pointerup", grab.x + 20, grab.y),
    ]);
    const moved = Float32Array.from(pointsOf(r.doc(), 1));
    const grabbedPoint = r.screenOf({ x: at(moved, 0) + 50, y: at(moved, 1) + 50 });
    assert.ok(Math.abs(grabbedPoint.x - (grab.x + 20)) < 1e-3, `x ${grabbedPoint.x}`);
    assert.ok(Math.abs(grabbedPoint.y - grab.y) < 1e-3, `y ${grabbedPoint.y}`);
    assert.deepEqual(r.commits, ["Move"]);
  });

  test("a zoom in the middle of a marquee keeps the far corner under the pointer", () => {
    const r = cameraRig(twoSquares, { x: 300, y: 300, zoom: 0 });
    const from = r.screenOf({ x: 50, y: 50 });
    r.replay([
      pointer("pointerdown", from.x, from.y),
      pointer("pointermove", from.x + 100, from.y + 100),
    ]);
    r.setCamera({ x: 300, y: 300, zoom: 1 });
    r.replay([pointer("pointermove", from.x + 100, from.y + 100)]);
    const marquee = r.tool.state().marquee;
    assert.ok(marquee !== null);
    const far = r.screenOf({ x: marquee[2], y: marquee[3] });
    assert.ok(Math.abs(far.x - (from.x + 100)) < 1e-3);
    assert.ok(Math.abs(far.y - (from.y + 100)) < 1e-3);
    assert.deepEqual(marquee.slice(0, 2), [50, 50]);
  });

  test("a zoom in the middle of a vertex drag keeps the vertex under the pointer", () => {
    const r = cameraRig(twoSquares, { x: 200, y: 200, zoom: 0 });
    const pick = r.screenOf({ x: 150, y: 150 });
    r.replay(click(pick.x, pick.y));
    const vertex = r.screenOf({ x: 300, y: 300 });
    r.replay([
      pointer("pointerdown", vertex.x, vertex.y),
      pointer("pointermove", vertex.x + 10, vertex.y),
    ]);
    r.setCamera({ x: 220, y: 180, zoom: 2 });
    r.replay([
      pointer("pointermove", vertex.x + 10, vertex.y),
      pointer("pointerup", vertex.x + 10, vertex.y),
    ]);
    const moved = Float32Array.from(pointsOf(r.doc(), 1));
    const landed = r.screenOf({ x: at(moved, 4), y: at(moved, 5) });
    assert.ok(Math.abs(landed.x - (vertex.x + 10)) < 1e-3, `x ${landed.x}`);
    assert.ok(Math.abs(landed.y - vertex.y) < 1e-3, `y ${landed.y}`);
  });

  test("undo after a reshape restores the vertex and keeps the selection", () => {
    const r = cameraRig(twoSquares, { x: 200, y: 200, zoom: 1 });
    const pick = r.screenOf({ x: 150, y: 150 });
    r.replay(click(pick.x, pick.y));
    const vertex = r.screenOf({ x: 300, y: 300 });
    const before = r.doc();
    r.replay(drag([vertex.x, vertex.y], [vertex.x + 30, vertex.y + 30]));
    assert.notDeepEqual(pointsOf(r.doc(), 1), pointsOf(before, 1));
    r.tool.prune(before);
    assert.deepEqual(pointsOf(before, 1), [100, 100, 300, 100, 300, 300, 100, 300]);
    assert.deepEqual(r.ids(), [1]);
  });

  test("a stray move after the pointer was cancelled changes nothing", () => {
    const r = cameraRig(twoSquares, { x: 200, y: 200, zoom: 0 });
    const grab = r.screenOf({ x: 150, y: 150 });
    r.replay(click(grab.x, grab.y));
    r.replay([pointer("pointerdown", grab.x, grab.y), pointer("pointermove", grab.x + 20, grab.y)]);
    r.replay([pointer("pointercancel", grab.x + 20, grab.y)]);
    const consumed = r.replay([pointer("pointermove", grab.x + 80, grab.y + 80)]);
    assert.deepEqual(consumed, [false]);
    assert.deepEqual(pointsOf(r.doc(), 1).slice(0, 2), [100, 100]);
    assert.equal(r.tool.state().gesture, "idle");
  });
});
