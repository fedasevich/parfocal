import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { drawCurrentView, layersNeedUpdate, maxUpdatePasses } from "../../src/viv/draw-once.ts";

function fakeDeck(updatesNeeded: number) {
  const calls: string[] = [];
  let pending = updatesNeeded;
  const layer = (name: string, isComposite: boolean) => ({
    isComposite,
    activateViewport: (viewport: unknown) => calls.push(`${name} sees ${String(viewport)}`),
  });
  const deck = {
    layerManager: {
      getLayers: () => [layer("tiles", true), layer("bitmap", false)],
      activateViewport: (viewport: unknown) => calls.push(`context ${String(viewport)}`),
      needsUpdate: () => (pending > 0 ? "viewport changed" : false),
      updateLayers: () => {
        pending -= 1;
        calls.push("update");
      },
    },
    viewManager: { getViewports: () => ["slide"] },
    redraw: (reason?: string) => calls.push(`redraw ${reason}`),
  };
  return { deck, calls };
}

describe("drawing the current view once", () => {
  it("gives composite layers the viewport, updates them and then draws once", () => {
    const { deck, calls } = fakeDeck(1);
    drawCurrentView(deck, "camera");
    assert.deepEqual(calls, [
      "context slide",
      "tiles sees slide",
      "update",
      "context slide",
      "tiles sees slide",
      "redraw camera",
    ]);
  });

  it("draws without an update when no layer asks for one", () => {
    const { deck, calls } = fakeDeck(0);
    drawCurrentView(deck, "camera");
    assert.deepEqual(calls, ["context slide", "tiles sees slide", "redraw camera"]);
  });

  it("stops updating after a few passes and still draws", () => {
    const { deck, calls } = fakeDeck(100);
    drawCurrentView(deck, "camera");
    assert.equal(calls.filter((call) => call === "update").length, maxUpdatePasses);
    assert.equal(calls.at(-1), "redraw camera");
  });

  it("does nothing before the deck has its managers", () => {
    const calls: string[] = [];
    const deck = { layerManager: null, viewManager: null, redraw: () => calls.push("redraw") };
    drawCurrentView(deck, "camera");
    assert.deepEqual(calls, []);
  });

  it("reports whether a layer update is waiting", () => {
    assert.equal(layersNeedUpdate(fakeDeck(1).deck), true);
    assert.equal(layersNeedUpdate(fakeDeck(0).deck), false);
    assert.equal(layersNeedUpdate({ layerManager: null }), false);
  });
});
