import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { bindClickPress, clickSlopScreenPixels } from "../src/annotations/click-press.ts";

type Listener = (event: FakeEvent) => void;

class FakeEvent {
  stopped = false;
  prevented = false;
  readonly type: string;
  readonly pointerId: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly button: number;
  constructor(type: string, pointerId: number, clientX: number, clientY: number, button = 0) {
    this.type = type;
    this.pointerId = pointerId;
    this.clientX = clientX;
    this.clientY = clientY;
    this.button = button;
  }
  stopImmediatePropagation() {
    this.stopped = true;
  }
  preventDefault() {
    this.prevented = true;
  }
}

function fakeStage() {
  const listeners = new Map<string, Listener[]>();
  const captured: number[] = [];
  const stage = {
    addEventListener: (type: string, listener: Listener) => {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    removeEventListener: (type: string, listener: Listener) => {
      listeners.set(
        type,
        (listeners.get(type) ?? []).filter((item) => item !== listener),
      );
    },
    setPointerCapture: (id: number) => {
      captured.push(id);
    },
    releasePointerCapture: (id: number) => {
      captured.splice(captured.indexOf(id), 1);
    },
  };
  const fire = (type: string, pointerId: number, x: number, y: number, button = 0) => {
    const event = new FakeEvent(type, pointerId, x, y, button);
    for (const listener of listeners.get(type) ?? []) listener(event);
    return event;
  };
  return { stage, fire, captured, listenerCount: () => [...listeners.values()].flat().length };
}

function fakeEngine() {
  const calls: string[] = [];
  return {
    calls,
    engine: {
      startDrag: (at: { clientX: number; clientY: number }) =>
        calls.push(`start ${at.clientX},${at.clientY}`),
      dragTo: (at: { clientX: number; clientY: number }) =>
        calls.push(`drag ${at.clientX},${at.clientY}`),
      endDrag: () => calls.push("end"),
      stopMotion: () => calls.push("stop"),
    },
  };
}

type Cast = Parameters<typeof bindClickPress>[0];

function bind(ignore?: (event: PointerEvent) => boolean) {
  const { stage, fire, captured, listenerCount } = fakeStage();
  const { engine, calls } = fakeEngine();
  const clicks: { x: number; y: number }[] = [];
  const unbind = bindClickPress(stage as unknown as Cast, {
    engine: () => engine,
    onClick: (event) => clicks.push({ x: event.clientX, y: event.clientY }),
    ...(ignore ? { ignore } : {}),
  });
  return { fire, captured, calls, clicks, unbind, listenerCount };
}

describe("a click tool press keeps the engine out of the click", () => {
  test("the press stops the engine seeing pointerdown and captures the pointer", () => {
    const { fire, captured } = bind();
    const down = fire("pointerdown", 1, 100, 100);
    assert.equal(down.stopped, true);
    assert.equal(down.prevented, true);
    assert.deepEqual(captured, [1]);
  });

  test("a release within the slop is a click at the release point and never pans", () => {
    const { fire, calls, clicks, captured } = bind();
    fire("pointerdown", 1, 100, 100);
    fire("pointermove", 1, 102, 101);
    const up = fire("pointerup", 1, 102, 101);
    assert.equal(up.stopped, true);
    assert.deepEqual(clicks, [{ x: 102, y: 101 }]);
    assert.deepEqual(calls, []);
    assert.deepEqual(captured, []);
  });

  test("a release exactly at the slop is still a click", () => {
    const { fire, clicks } = bind();
    fire("pointerdown", 1, 100, 100);
    fire("pointerup", 1, 100 + clickSlopScreenPixels, 100);
    assert.equal(clicks.length, 1);
  });

  test("past the slop the press becomes an engine drag from the press point and drops nothing", () => {
    const { fire, calls, clicks } = bind();
    fire("pointerdown", 1, 100, 100);
    fire("pointermove", 1, 101, 100);
    fire("pointermove", 1, 110, 104);
    fire("pointermove", 1, 150, 130);
    fire("pointerup", 1, 150, 130);
    assert.deepEqual(calls, ["start 100,100", "drag 110,104", "drag 150,130", "end"]);
    assert.deepEqual(clicks, []);
  });

  test("a fast move straight past the slop still starts the drag at the press point", () => {
    const { fire, calls } = bind();
    fire("pointerdown", 1, 10, 10);
    fire("pointermove", 1, 300, 200);
    assert.deepEqual(calls, ["start 10,10", "drag 300,200"]);
  });

  test("a cancelled drag stops the motion and a cancelled click drops nothing", () => {
    const { fire, calls, clicks } = bind();
    fire("pointerdown", 1, 10, 10);
    fire("pointermove", 1, 60, 10);
    fire("pointercancel", 1, 60, 10);
    assert.deepEqual(calls, ["start 10,10", "drag 60,10", "stop"]);
    fire("pointerdown", 2, 10, 10);
    fire("lostpointercapture", 2, 10, 10);
    fire("pointerup", 2, 10, 10);
    assert.deepEqual(clicks, []);
  });

  test("other pointers and other buttons are left alone", () => {
    const { fire, clicks, calls } = bind();
    const right = fire("pointerdown", 1, 10, 10, 2);
    assert.equal(right.stopped, false);
    fire("pointerup", 1, 10, 10, 2);
    fire("pointerdown", 3, 10, 10);
    const stray = fire("pointermove", 4, 90, 90);
    assert.equal(stray.stopped, false);
    fire("pointerup", 4, 90, 90);
    fire("pointerup", 3, 11, 10);
    assert.deepEqual(clicks, [{ x: 11, y: 10 }]);
    assert.deepEqual(calls, []);
  });

  test("an ignored press, such as one on a pin, passes through untouched", () => {
    const { fire, clicks } = bind((event) => event.clientX > 500);
    const down = fire("pointerdown", 1, 600, 10);
    assert.equal(down.stopped, false);
    fire("pointerup", 1, 600, 10);
    assert.deepEqual(clicks, []);
  });

  test("a double click is swallowed so the viewer does not zoom", () => {
    const { fire } = bind();
    const twice = fire("dblclick", 1, 10, 10);
    assert.equal(twice.stopped, true);
    assert.equal(twice.prevented, true);
  });

  test("unbinding removes every listener", () => {
    const { unbind, listenerCount } = bind();
    assert.equal(listenerCount(), 6);
    unbind();
    assert.equal(listenerCount(), 0);
  });
});
