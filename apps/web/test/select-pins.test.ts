import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { type AnnotationDocument, addShape, createDocument } from "../src/annotations/document.ts";
import { removalDetail, removalTitle } from "../src/annotations/pin-removal.ts";
import { pinPoint } from "../src/annotations/pins.ts";
import type { Point } from "../src/annotations/polygon-draft.ts";
import { createSelectTool } from "../src/annotations/select-tool.ts";

const none = { ctrlKey: false, shiftKey: false, altKey: false, metaKey: false };

type Kind = "down" | "move" | "up";

function input(kind: Kind, x: number, y: number, shiftKey = false) {
  return {
    kind,
    clientX: x,
    clientY: y,
    pointerId: 1,
    pointerType: "mouse",
    button: 0,
    buttons: kind === "up" ? 0 : 1,
    ...none,
    shiftKey,
  };
}

function drag(from: readonly [number, number], to: readonly [number, number], shiftKey = false) {
  return [
    input("down", from[0], from[1], shiftKey),
    input("move", (from[0] + to[0]) / 2, (from[1] + to[1]) / 2, shiftKey),
    input("move", to[0], to[1], shiftKey),
    input("up", to[0], to[1], shiftKey),
  ];
}

const click = (x: number, y: number, shiftKey = false) => [
  input("down", x, y, shiftKey),
  input("up", x, y, shiftKey),
];

const square = (x: number, y: number, size: number) =>
  Float32Array.of(x, y, x + size, y, x + size, y + size, x, y + size);

function rig() {
  let doc: AnnotationDocument = addShape(createDocument(), {
    kind: "polygon",
    points: square(100, 100, 100),
  }).document;
  const anchors = new Map<string, Point>([
    ["t1", { x: 400, y: 400 }],
    ["t2", { x: 600, y: 400 }],
  ]);
  const opened: string[] = [];
  const asked: string[][] = [];
  let proceed: () => void = () => undefined;
  const commits: string[] = [];
  const tool = createSelectTool({
    document: () => doc,
    setDocument: (next) => {
      doc = next;
    },
    toSlide: (point) => ({ x: point.clientX, y: point.clientY }),
    pixelSize: () => 1,
    commit: (_before, _after, label) => commits.push(label),
    pins: {
      points: () => {
        const found = new Map<string, Point>();
        for (const [id, anchor] of anchors) {
          const point = pinPoint(doc, id, anchor);
          if (point !== null) found.set(id, point);
        }
        return found;
      },
      open: (id) => opened.push(id),
      remove: (ids, next) => {
        asked.push([...ids]);
        proceed = next;
      },
    },
  });
  const replay = (events: ReturnType<typeof drag>) => {
    for (const event of events) tool.handle(event);
  };
  return {
    tool,
    replay,
    doc: () => doc,
    opened,
    asked,
    commits,
    confirm: () => proceed(),
    spot: (id: string) => pinPoint(doc, id, anchors.get(id) ?? null),
  };
}

describe("picking comment pins", () => {
  test("a click on a pin body picks it and opens its thread", () => {
    const r = rig();
    r.replay(click(410, 390));
    assert.deepEqual(r.tool.state().pinIds, ["t1"]);
    assert.deepEqual(r.opened, ["t1"]);
  });

  test("a click beside the pin picks nothing", () => {
    const r = rig();
    r.replay(click(390, 410));
    assert.deepEqual(r.tool.state().pinIds, []);
  });

  test("Shift adds a second pin and a shape beside the first", () => {
    const r = rig();
    r.replay(click(410, 390));
    r.replay(click(610, 390, true));
    r.replay(click(150, 150, true));
    assert.deepEqual(r.tool.state().pinIds, ["t1", "t2"]);
    assert.deepEqual(r.tool.state().ids, [1]);
  });

  test("a click on a shape without Shift drops the picked pins", () => {
    const r = rig();
    r.replay(click(410, 390));
    r.replay(click(150, 150));
    assert.deepEqual(r.tool.state().pinIds, []);
    assert.deepEqual(r.tool.state().ids, [1]);
  });

  test("a marquee picks the pins and shapes it covers", () => {
    const r = rig();
    r.replay(drag([50, 50], [650, 420]));
    assert.deepEqual(r.tool.state().pinIds, ["t1", "t2"]);
    assert.deepEqual(r.tool.state().ids, [1]);
  });
});

describe("moving comment pins", () => {
  test("dragging a pin moves it and commits one step", () => {
    const r = rig();
    r.replay(drag([410, 390], [450, 360]));
    assert.deepEqual(r.spot("t1"), { x: 440, y: 370 });
    assert.deepEqual(r.spot("t2"), { x: 600, y: 400 });
    assert.deepEqual(r.commits, ["Move comment pin"]);
  });

  test("dragging a picked pin takes the picked shape with it", () => {
    const r = rig();
    r.replay(click(150, 150));
    r.replay(click(410, 390, true));
    r.replay(drag([410, 390], [430, 410]));
    assert.deepEqual(r.spot("t1"), { x: 420, y: 420 });
    assert.deepEqual([...(r.doc().shapes.get(1)?.points ?? [])].slice(0, 2), [120, 120]);
  });

  test("an arrow key nudges the picked pins as one history step", () => {
    const r = rig();
    r.replay(click(410, 390));
    assert.equal(r.tool.nudge(10, 0), true);
    assert.deepEqual(r.spot("t1"), { x: 410, y: 400 });
    assert.deepEqual(r.commits, ["Nudge"]);
  });

  test("Escape during a pin drag puts the pin back", () => {
    const r = rig();
    r.replay([input("down", 410, 390), input("move", 470, 350), input("move", 480, 340)]);
    r.tool.cancel();
    assert.deepEqual(r.spot("t1"), { x: 400, y: 400 });
    assert.deepEqual(r.commits, []);
  });
});

describe("deleting comment pins", () => {
  test("Delete asks first and removes nothing until it is confirmed", () => {
    const r = rig();
    r.replay(click(150, 150));
    r.replay(click(410, 390, true));
    assert.equal(r.tool.removeSelected(), true);
    assert.deepEqual(r.asked, [["t1"]]);
    assert.equal(r.doc().shapes.size, 1);
    assert.deepEqual(r.tool.state().pinIds, ["t1"]);
    assert.deepEqual(r.commits, []);
  });

  test("a cancelled delete leaves the picks, the shapes and the history as they were", () => {
    const r = rig();
    r.replay(click(410, 390));
    r.tool.removeSelected();
    assert.deepEqual(r.tool.state().pinIds, ["t1"]);
    assert.equal(r.doc().shapes.size, 1);
    assert.deepEqual(r.commits, []);
  });

  test("a confirmed delete takes the picked shapes too and clears the picks", () => {
    const r = rig();
    r.replay(click(150, 150));
    r.replay(click(410, 390, true));
    r.tool.removeSelected();
    r.confirm();
    assert.equal(r.doc().shapes.size, 0);
    assert.deepEqual(r.tool.state().pinIds, []);
    assert.deepEqual(r.tool.state().ids, []);
    assert.deepEqual(r.commits, ["Delete"]);
  });

  test("the question names how many threads go and how many replies go with them", () => {
    const threads = [
      { id: "t1", message_count: 3 },
      { id: "t2", message_count: 1 },
    ];
    assert.equal(removalTitle(1), "Delete 1 comment thread?");
    assert.equal(removalTitle(2), "Delete 2 comment threads?");
    assert.match(removalDetail(["t1", "t2"], threads), /removes 2 comment threads and 2 replies/);
    assert.match(removalDetail(["t2"], threads), /removes 1 comment thread for everyone/);
  });
});
