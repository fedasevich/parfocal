import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMotionPredictor, motionPredictorTuning } from "../src/index.ts";

const viewport = { width: 1000, height: 600 };

function run(points: readonly (readonly [number, number])[], step = 16, zoom = 0) {
  const predictor = createMotionPredictor();
  for (const [index, [x, y]] of points.entries()) {
    predictor.sample(index * step, { x, y, zoom });
  }
  return predictor;
}

function line(count: number, vx: number, vy: number, step = 16) {
  return Array.from(
    { length: count },
    (_, index) => [index * vx * step, index * vy * step] as const,
  );
}

describe("the motion predictor", () => {
  it("keeps the tuned constants of the spec", () => {
    assert.equal(motionPredictorTuning.windowMs, 160);
    assert.equal(motionPredictorTuning.halfLifeMs, 55);
    assert.equal(motionPredictorTuning.minStraightness, 0.7);
    assert.equal(motionPredictorTuning.leadMs, 300);
    assert.equal(motionPredictorTuning.maxViewports, 1.25);
  });

  it("predicts the point 300 ms ahead on a steady straight pan", () => {
    const prediction = run(line(20, 1, 0)).predict(viewport);
    assert.ok(prediction);
    assert.ok(Math.abs(prediction.vector.vx - 1) < 1e-9);
    assert.ok(Math.abs(prediction.target.x - (19 * 16 + 300)) < 1e-6);
    assert.ok(Math.abs(prediction.target.y) < 1e-9);
  });

  it("caps the lead at 1.25 viewports along the direction", () => {
    const prediction = run(line(20, 20, 0)).predict(viewport);
    assert.ok(prediction);
    assert.ok(Math.abs(prediction.target.x - 19 * 16 * 20 - 1250) < 1e-6);
  });

  it("only looks at the last 160 ms", () => {
    const predictor = createMotionPredictor();
    let x = 0;
    for (let index = 0; index < 30; index++) {
      predictor.sample(index * 16, { x, y: 0, zoom: 0 });
      x += index < 15 ? -32 : 16;
    }
    const vector = predictor.vector();
    assert.ok(vector);
    assert.ok(Math.abs(vector.vx - 1) < 1e-9);
  });

  it("weights recent movement with a 55 ms half-life", () => {
    const predictor = createMotionPredictor();
    let x = 0;
    for (let index = 0; index < 11; index++) {
      predictor.sample(index * 16, { x, y: 0, zoom: 0 });
      x += index < 5 ? 0.5 * 16 : 2 * 16;
    }
    const vector = predictor.vector();
    assert.ok(vector);
    assert.ok(vector.vx > 1.25);
    assert.ok(vector.vx < 2);
  });

  it("predicts nothing for a zig-zag path", () => {
    const points = Array.from(
      { length: 12 },
      (_, index) => [index * 2, index % 2 === 0 ? 0 : 200] as const,
    );
    const predictor = run(points);
    const vector = predictor.vector();
    assert.ok(vector);
    assert.ok(vector.straightness < 0.7);
    assert.equal(predictor.predict(viewport), null);
  });

  it("predicts nothing for a slow drift or a standing camera", () => {
    assert.equal(run(line(20, 0.05, 0)).predict(viewport), null);
    assert.equal(run(line(20, 0, 0)).predict(viewport), null);
  });

  it("starts over when the zoom changes", () => {
    const predictor = createMotionPredictor();
    predictor.sample(0, { x: 0, y: 0, zoom: 0 });
    predictor.sample(16, { x: 16, y: 0, zoom: 0 });
    predictor.sample(32, { x: 32, y: 0, zoom: 1 });
    assert.equal(predictor.vector(), null);
  });
});
