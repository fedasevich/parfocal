import assert from "node:assert/strict";
import { test } from "node:test";
import type { Deck } from "@deck.gl/core";
import { type DisposableDevice, disposeDeck, releaseDevice } from "../../src/viv/dispose-deck.ts";

class FakeGl {
  lost = false;
  readonly calls: string[];

  constructor(calls: string[]) {
    this.calls = calls;
  }

  isContextLost() {
    return this.lost;
  }

  getExtension(name: string) {
    if (name !== "WEBGL_lose_context") return null;
    return {
      loseContext: () => {
        this.calls.push("loseContext");
        this.lost = true;
      },
    };
  }
}

function fakeDevice(calls: string[]): DisposableDevice & { gl: FakeGl } {
  return {
    canvasContext: { destroy: () => calls.push("canvasContext.destroy") },
    gl: new FakeGl(calls),
  };
}

function fakeCanvas(calls: string[]) {
  return {
    width: 800,
    height: 600,
    remove: () => calls.push("remove"),
  };
}

function fakeDeck(
  calls: string[],
  internals: { device?: DisposableDevice | null; pending?: Promise<unknown> },
): Deck {
  return {
    device: internals.device ?? null,
    animationLoop: { props: { device: internals.pending ?? internals.device ?? null } },
    finalize: () => calls.push("finalize"),
  } as unknown as Deck;
}

test("dispose finalizes, destroys the canvas context, loses the context and removes the canvas in that order", () => {
  const calls: string[] = [];
  const canvas = fakeCanvas(calls);
  disposeDeck(fakeDeck(calls, { device: fakeDevice(calls) }), canvas);
  assert.deepEqual(calls, ["finalize", "canvasContext.destroy", "loseContext", "remove"]);
  assert.equal(canvas.width, 0);
  assert.equal(canvas.height, 0);
});

test("a context that is already lost is not lost again", () => {
  const calls: string[] = [];
  const device = fakeDevice(calls);
  device.gl.lost = true;
  disposeDeck(fakeDeck(calls, { device }), fakeCanvas(calls));
  assert.deepEqual(calls, ["finalize", "canvasContext.destroy", "remove"]);
});

test("a device that arrives after dispose is released when it arrives", async () => {
  const calls: string[] = [];
  let resolve: (device: DisposableDevice) => void = () => {};
  const pending = new Promise<DisposableDevice>((done) => {
    resolve = done;
  });
  disposeDeck(fakeDeck(calls, { pending }), fakeCanvas(calls));
  assert.deepEqual(calls, ["finalize", "remove"]);
  resolve(fakeDevice(calls));
  await pending;
  await Promise.resolve();
  assert.deepEqual(calls, ["finalize", "remove", "canvasContext.destroy", "loseContext"]);
});

test("a device that fails to arrive does not throw after dispose", async () => {
  const calls: string[] = [];
  const pending = Promise.reject(new Error("no WebGL2"));
  disposeDeck(fakeDeck(calls, { pending }), fakeCanvas(calls));
  await assert.rejects(pending);
  assert.deepEqual(calls, ["finalize", "remove"]);
});

test("releasing a device without a canvas context still loses its WebGL context", () => {
  const calls: string[] = [];
  const gl = new FakeGl(calls);
  releaseDevice({ canvasContext: null, gl });
  releaseDevice(null);
  assert.deepEqual(calls, ["loseContext"]);
});
