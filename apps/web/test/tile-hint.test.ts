import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clipToStage, hintCopy, tileHintOf } from "../src/viewer/tile-hint.ts";

const state = (pending: number, waitingMs: number, answerMs: number | null = null) => ({
  pending,
  waitingMs,
  answerMs,
});

describe("tile hint", () => {
  it("stays quiet until sharp tiles have taken a second", () => {
    assert.equal(tileHintOf(state(12, 0)), null);
    assert.equal(tileHintOf(state(12, 999)), null);
    assert.equal(tileHintOf(state(0, 3000)), null);
  });

  it("counts the tiles left from one second on", () => {
    const hint = tileHintOf(state(12, 1000));
    assert.deepEqual(hint, { kind: "loading", left: 12 });
    assert.equal(hintCopy({ kind: "loading", left: 12 }), "Loading sharper tiles · 12 left");
  });

  it("names the slow source with how long it answers from five seconds on", () => {
    assert.equal(tileHintOf(state(3, 4999))?.kind, "loading");
    const hint = tileHintOf(state(3, 5000, 2400));
    assert.deepEqual(hint, { kind: "slow", answers: "2.4 s" });
    assert.match(
      hintCopy({ kind: "slow", answers: "2.4 s" }),
      /^Slow source\. The slide storage answers in 2\.4 s\./,
    );
  });
});

describe("tile hint while the slide opens", () => {
  it("says the slide is loading after a second and names the slow source after five", () => {
    assert.equal(tileHintOf(state(0, 900), true), null);
    assert.deepEqual(tileHintOf(state(0, 1200), true), { kind: "opening" });
    assert.deepEqual(tileHintOf(state(0, 6100, 6100), true), { kind: "slow", answers: "6.1 s" });
  });
});

describe("checker box", () => {
  const stage = { width: 800, height: 600 };

  it("keeps the part of the slide that is on the stage", () => {
    assert.deepEqual(clipToStage({ left: -100, top: 50, width: 500, height: 700 }, stage), {
      left: 0,
      top: 50,
      width: 400,
      height: 550,
    });
  });

  it("leaves nothing when the slide is off the stage", () => {
    const box = clipToStage({ left: 900, top: 0, width: 100, height: 100 }, stage);
    assert.equal(box.width, 0);
  });

  it("never grows past the slide when the slide is smaller than the stage", () => {
    assert.deepEqual(clipToStage({ left: 100, top: 100, width: 200, height: 100 }, stage), {
      left: 100,
      top: 100,
      width: 200,
      height: 100,
    });
  });
});
