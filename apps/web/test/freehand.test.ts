import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  finishStroke,
  simplifyPath,
  simplifyToleranceScreenPixels,
  strokeSamples,
} from "../src/annotations/freehand.ts";

function eventWith(coalesced: readonly { clientX: number; clientY: number }[] | null) {
  const event = { clientX: 99, clientY: 99 } as unknown as PointerEvent;
  if (coalesced !== null) {
    Object.assign(event, { getCoalescedEvents: () => coalesced as unknown as PointerEvent[] });
  }
  return event;
}

describe("freehand strokes", () => {
  test("a move event contributes every coalesced sample", () => {
    const samples = strokeSamples(
      eventWith([
        { clientX: 1, clientY: 1 },
        { clientX: 2, clientY: 2 },
        { clientX: 3, clientY: 3 },
      ]),
    );
    assert.deepEqual(
      samples.map((s) => s.clientX),
      [1, 2, 3],
    );
  });

  test("a browser without coalesced events falls back to the event itself", () => {
    assert.equal(strokeSamples(eventWith(null)).length, 1);
    assert.equal(strokeSamples(eventWith([])).length, 1);
  });

  test("simplification keeps the original path within tolerance of the result", () => {
    const circle = Array.from({ length: 400 }, (_, i) => ({
      x: 500 + 300 * Math.cos((i / 400) * Math.PI * 2),
      y: 500 + 300 * Math.sin((i / 400) * Math.PI * 2),
    }));
    const tolerance = 2;
    const simplified = simplifyPath(circle, tolerance);
    assert.ok(simplified.length < circle.length / 4);
    assert.ok(simplified.length >= 8);
    for (const p of circle) {
      let best = Number.POSITIVE_INFINITY;
      for (let i = 0; i + 1 < simplified.length; i += 1) {
        const a = simplified[i];
        const b = simplified[i + 1];
        if (!a || !b) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const along = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy);
        const t = Math.max(0, Math.min(1, along));
        best = Math.min(best, Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy));
      }
      assert.ok(best <= tolerance + 1e-9);
    }
  });

  test("collinear samples collapse to the two end points", () => {
    const line = Array.from({ length: 50 }, (_, i) => ({ x: i * 3, y: i * 3 }));
    assert.equal(simplifyPath(line, 0.5).length, 2);
  });

  test("the tolerance is in screen pixels, so zooming in keeps more vertices", () => {
    const wobble = Array.from({ length: 200 }, (_, i) => ({
      x: i * 4,
      y: i % 2 === 0 ? 0 : 3,
    }));
    const zoomedOut = finishStroke(wobble, 0.5);
    const zoomedIn = finishStroke(wobble, 4);
    assert.ok(simplifyToleranceScreenPixels > 0);
    assert.ok((zoomedIn?.length ?? 0) > (zoomedOut?.length ?? 0));
  });

  test("a tiny scribble is dropped", () => {
    const dot = [
      { x: 10, y: 10 },
      { x: 11, y: 10 },
      { x: 11, y: 11 },
    ];
    assert.equal(finishStroke(dot, 1), null);
  });

  test("a real stroke becomes a flat ring of at least three vertices", () => {
    const arc = Array.from({ length: 60 }, (_, i) => ({
      x: 100 * Math.cos(i / 10),
      y: 100 * Math.sin(i / 10),
    }));
    const ring = finishStroke(arc, 1);
    assert.ok(ring !== null && ring.length >= 6 && ring.length % 2 === 0);
  });
});
