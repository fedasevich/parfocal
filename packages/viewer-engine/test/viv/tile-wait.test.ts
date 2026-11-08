import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createTileWait } from "../../src/viv/index.ts";

function clocked() {
  let time = 1000;
  const wait = createTileWait(() => time);
  return {
    wait,
    advance: (ms: number) => {
      time += ms;
    },
  };
}

describe("tile wait", () => {
  it("reports nothing while no tile is requested", () => {
    const { wait } = clocked();
    assert.deepEqual(wait.state(), { pending: 0, waitingMs: 0, answerMs: null });
  });

  it("counts how long tiles have been outstanding since the first one", () => {
    const { wait, advance } = clocked();
    wait.begin();
    advance(400);
    wait.begin();
    advance(700);
    const state = wait.state();
    assert.equal(state.pending, 2);
    assert.equal(state.waitingMs, 1100);
    assert.equal(state.answerMs, 1100);
  });

  it("starts a fresh wait once every tile has answered", () => {
    const { wait, advance } = clocked();
    const first = wait.begin();
    advance(300);
    wait.end(first, true);
    advance(5000);
    wait.begin();
    advance(100);
    assert.equal(wait.state().waitingMs, 100);
  });

  it("averages the recent answers and ignores aborted tiles", () => {
    const { wait, advance } = clocked();
    const a = wait.begin();
    advance(200);
    wait.end(a, true);
    const b = wait.begin();
    advance(400);
    wait.end(b, true);
    const aborted = wait.begin();
    advance(9000);
    wait.end(aborted, false);
    const state = wait.state();
    assert.equal(state.pending, 0);
    assert.equal(state.answerMs, 300);
  });

  it("lets a slow outstanding tile outweigh the quick answers", () => {
    const { wait, advance } = clocked();
    const quick = wait.begin();
    advance(100);
    wait.end(quick, true);
    wait.begin();
    advance(2400);
    assert.equal(wait.state().answerMs, 2400);
  });
});
