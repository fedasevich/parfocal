import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  bindSpacePan,
  capturePointer,
  interruptMotion,
  releasePointer,
  slideAt,
  stagePoint,
} from "../src/annotations/stage-pointer.ts";
import { screenScale, screenToSlide, slideToScreen } from "../src/viewer/viewer-engine.ts";

function lcg(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

const random = lcg(2026);
const between = (low: number, high: number) => low + (high - low) * random();

function randomRect() {
  return {
    left: between(-50, 400) * (random() < 0.5 ? 1 : 1.25),
    top: between(0, 300) + 0.25,
    width: between(200, 2600),
    height: between(150, 1600),
  };
}

function randomCamera() {
  return { x: between(0, 200_000), y: between(0, 150_000), zoom: between(-12, 4) };
}

describe("screen to slide round trip", () => {
  test("a screen point survives the trip to the slide and back at every zoom", () => {
    for (let round = 0; round < 500; round += 1) {
      const rect = randomRect();
      const camera = randomCamera();
      const x = rect.left + between(0, rect.width);
      const y = rect.top + between(0, rect.height);
      const back = slideToScreen(camera, rect, screenToSlide(camera, rect, x, y));
      assert.ok(
        Math.abs(back.x - x) < 1e-6,
        `x ${x} came back as ${back.x} at zoom ${camera.zoom}`,
      );
      assert.ok(
        Math.abs(back.y - y) < 1e-6,
        `y ${y} came back as ${back.y} at zoom ${camera.zoom}`,
      );
    }
  });

  test("a slide point survives the trip to the screen and back", () => {
    for (let round = 0; round < 500; round += 1) {
      const rect = randomRect();
      const camera = randomCamera();
      const point = { x: between(0, 200_000), y: between(0, 150_000) };
      const screen = slideToScreen(camera, rect, point);
      const back = screenToSlide(camera, rect, screen.x, screen.y);
      const slack = 1e-6 / screenScale(camera);
      assert.ok(Math.abs(back.x - point.x) <= Math.max(slack, 1e-7 * point.x));
      assert.ok(Math.abs(back.y - point.y) <= Math.max(slack, 1e-7 * point.y));
    }
  });

  test("storing a slide point as float32 moves it by well under a screen pixel at the deepest zoom", () => {
    for (let round = 0; round < 500; round += 1) {
      const camera = { ...randomCamera(), zoom: 4 };
      const rect = randomRect();
      const point = { x: between(0, 200_000), y: between(0, 150_000) };
      const stored = Float32Array.of(point.x, point.y);
      const before = slideToScreen(camera, rect, point);
      const after = slideToScreen(camera, rect, { x: stored[0] ?? 0, y: stored[1] ?? 0 });
      assert.ok(Math.abs(after.x - before.x) < 0.25, `drift ${after.x - before.x}`);
      assert.ok(Math.abs(after.y - before.y) < 0.25, `drift ${after.y - before.y}`);
    }
  });

  test("the centre of the stage is the camera at every zoom and offset", () => {
    for (let round = 0; round < 100; round += 1) {
      const rect = randomRect();
      const camera = randomCamera();
      const centre = screenToSlide(
        camera,
        rect,
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
      );
      assert.ok(Math.abs(centre.x - camera.x) < 1e-9);
      assert.ok(Math.abs(centre.y - camera.y) < 1e-9);
    }
  });

  test("a screen step of one pixel is one over the scale on the slide", () => {
    for (const zoom of [-12, -3.3, 0, 1.5, 4]) {
      const camera = { x: 1000, y: 1000, zoom };
      const rect = { left: 0, top: 0, width: 800, height: 600 };
      const a = screenToSlide(camera, rect, 100, 100);
      const b = screenToSlide(camera, rect, 101, 100);
      assert.ok(Math.abs(b.x - a.x - 1 / screenScale(camera)) < 1e-9);
    }
  });
});

describe("stage pointer helpers", () => {
  const bounds = () => ({ left: 10.5, top: 55.25, width: 800, height: 600 });
  const stage = { getBoundingClientRect: bounds } as unknown as HTMLElement;

  test("a client point becomes a stage point by the fractional stage offset", () => {
    assert.deepEqual(stagePoint(stage, { clientX: 110.5, clientY: 155.25 }), { x: 100, y: 100 });
  });

  test("the slide point under the pointer uses the camera as it is now", () => {
    let camera = { x: 0, y: 0, zoom: 0 };
    const engine = { getCamera: () => camera };
    const at = { clientX: 410.5, clientY: 355.25 };
    assert.deepEqual(slideAt(engine, stage, at), { x: 0, y: 0 });
    camera = { x: 500, y: 300, zoom: 1 };
    assert.deepEqual(slideAt(engine, stage, at), { x: 500, y: 300 });
  });

  test("the stage point of the pointer projects back to itself under any camera", () => {
    const camera = { x: 1234.5, y: 678.9, zoom: -2.5 };
    const engine = { getCamera: () => camera };
    const at = { clientX: 310.5, clientY: 255.25 };
    const point = stagePoint(stage, at);
    const slide = slideAt(engine, stage, at);
    const rect = { left: 0, top: 0, width: 800, height: 600 };
    const back = slideToScreen(camera, rect, slide);
    assert.ok(Math.abs(back.x - point.x) < 1e-9);
    assert.ok(Math.abs(back.y - point.y) < 1e-9);
  });

  test("capturing a pointer the browser has already let go does not throw", () => {
    const refusing = {
      setPointerCapture: () => {
        throw new DOMException("no active pointer", "NotFoundError");
      },
      releasePointerCapture: () => {
        throw new DOMException("no active pointer", "NotFoundError");
      },
      hasPointerCapture: () => true,
    };
    assert.doesNotThrow(() => capturePointer(refusing, 1));
    assert.doesNotThrow(() => releasePointer(refusing, 1));
  });

  test("a pointer is only released when the stage still holds it", () => {
    const released: number[] = [];
    const held = new Set([1]);
    const plain = {
      setPointerCapture: (id: number) => held.add(id),
      releasePointerCapture: (id: number) => {
        released.push(id);
        held.delete(id);
      },
      hasPointerCapture: (id: number) => held.has(id),
    };
    releasePointer(plain, 2);
    releasePointer(plain, 1);
    releasePointer(plain, 1);
    assert.deepEqual(released, [1]);
  });

  test("a press stops a coasting or flying camera and leaves a zoom or drag alone", () => {
    const stopped: string[] = [];
    for (const motion of ["idle", "dragging", "coasting", "zooming", "flying"] as const) {
      interruptMotion({ getMotion: () => motion, stopMotion: () => stopped.push(motion) });
    }
    assert.deepEqual(stopped, ["coasting", "flying"]);
  });
});

describe("Space held pans in any tool", () => {
  function panRig(gesturing: () => boolean) {
    const view = new EventTarget();
    const stage = {
      style: { cursor: "crosshair" },
      ownerDocument: { defaultView: view as unknown as Window },
    } as unknown as HTMLElement;
    const calls: string[] = [];
    const engine = {
      startDrag: (at: { clientX: number; clientY: number }) =>
        calls.push(`start ${at.clientX},${at.clientY}`),
      dragTo: (at: { clientX: number; clientY: number }) =>
        calls.push(`drag ${at.clientX},${at.clientY}`),
      endDrag: () => calls.push("end"),
      stopMotion: () => calls.push("stop"),
    };
    const pan = bindSpacePan(stage, { engine: () => engine, gesturing, typing: () => false });
    const key = (type: "keydown" | "keyup", key = " ", repeat = false) => {
      const event = Object.assign(new Event(type, { cancelable: true }), { key, repeat });
      view.dispatchEvent(event);
      return event.defaultPrevented;
    };
    return { pan, stage, calls, key, view };
  }

  test("holding Space is reported, shows a hand and swallows the page scroll", () => {
    const r = panRig(() => false);
    assert.equal(r.pan.held(), false);
    assert.equal(r.key("keydown"), true);
    assert.equal(r.pan.held(), true);
    assert.equal(r.stage.style.cursor, "grab");
    assert.equal(r.key("keydown", " ", true), true);
    r.key("keyup");
    assert.equal(r.pan.held(), false);
    assert.equal(r.stage.style.cursor, "crosshair");
    assert.deepEqual(r.calls, []);
  });

  test("other keys and a window blur are handled sensibly", () => {
    const r = panRig(() => false);
    assert.equal(r.key("keydown", "a"), false);
    assert.equal(r.pan.held(), false);
    r.key("keydown");
    r.view.dispatchEvent(new Event("blur"));
    assert.equal(r.pan.held(), false);
    assert.equal(r.stage.style.cursor, "crosshair");
  });

  test("Space in the middle of a gesture drags the camera from the last pointer until released", () => {
    let busy = true;
    const r = panRig(() => busy);
    r.pan.track({ clientX: 100, clientY: 100 });
    r.key("keydown");
    assert.equal(r.pan.panning(), true);
    assert.equal(r.pan.steer({ clientX: 120, clientY: 90 }), true);
    assert.equal(r.pan.steer({ clientX: 140, clientY: 80 }), true);
    r.key("keyup");
    assert.equal(r.pan.panning(), false);
    assert.equal(r.pan.steer({ clientX: 150, clientY: 80 }), false);
    busy = false;
    assert.deepEqual(r.calls, ["start 100,100", "drag 120,90", "drag 140,80", "end", "stop"]);
  });

  test("Space with no gesture starts nothing, because the engine takes the press itself", () => {
    const r = panRig(() => false);
    r.pan.track({ clientX: 100, clientY: 100 });
    r.key("keydown");
    assert.equal(r.pan.panning(), false);
    assert.equal(r.pan.steer({ clientX: 120, clientY: 90 }), false);
    assert.deepEqual(r.calls, []);
  });

  test("releasing the pointer or disposing ends a pan in flight", () => {
    const r = panRig(() => true);
    r.pan.track({ clientX: 1, clientY: 1 });
    r.key("keydown");
    r.pan.release();
    r.pan.release();
    assert.deepEqual(r.calls, ["start 1,1", "end", "stop"]);
    r.key("keyup");
    r.key("keydown");
    r.pan.dispose();
    assert.deepEqual(r.calls, ["start 1,1", "end", "stop", "start 1,1", "end", "stop"]);
    assert.equal(r.stage.style.cursor, "crosshair");
  });
});
