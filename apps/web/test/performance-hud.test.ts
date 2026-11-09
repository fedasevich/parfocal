import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createFrameMeter, hudLines, hudRefreshMs } from "../src/lab/hud-meter.ts";
import { labDefaults, parseLabSettings } from "../src/lab/lab-settings.ts";

const budgetMs = 0.5;

describe("the frame meter", () => {
  test("reads fps, mean and p95 frame time from steady and slow frames", () => {
    const meter = createFrameMeter(100);
    let now = 0;
    for (let index = 0; index < 100; index += 1) {
      now += index % 10 === 9 ? 40 : 10;
      meter.record(now);
    }
    const summary = meter.summary();
    assert.equal(Math.round(summary.frameMs), 13);
    assert.equal(summary.frameP95Ms, 40);
    assert.equal(Math.round(summary.fps), 77);
  });

  test("reads zero before two frames and keeps only the latest window", () => {
    const meter = createFrameMeter(4);
    assert.equal(meter.summary().fps, 0);
    meter.record(0);
    assert.equal(meter.summary().fps, 0);
    for (let step = 1; step <= 8; step += 1) meter.record(step * 100);
    meter.record(800 + 10);
    assert.ok(meter.summary().frameMs < 100);
  });
});

describe("the HUD readout", () => {
  const input = {
    route: "viv" as const,
    frame: { fps: 60, frameMs: 16.7, frameP95Ms: 20 },
    residentTiles: 412,
    inflight: 6,
    decodeP95Ms: 4.2,
    atlasUsed: 0.4,
    annotationsDrawn: 18_240,
    annotationsTotal: 100_000,
    lodTier: "tiered",
  };

  test("shows every readout and hides atlas use off the WebGPU route", () => {
    const text = hudLines(input).join("\n");
    assert.match(text, /60 fps/);
    assert.match(text, /412 resident/);
    assert.match(text, /6 in flight/);
    assert.match(text, /decode p95 4\.2 ms/);
    assert.match(text, /18,240 drawn · 81,760 culled/);
    assert.match(text, /lod tiered/);
    assert.doesNotMatch(text, /atlas/);
  });

  test("shows atlas use on the WebGPU route and dashes for unknown numbers", () => {
    const text = hudLines({ ...input, route: "webgpu", residentTiles: null, decodeP95Ms: null });
    assert.match(text.join("\n"), /atlas 40% used/);
    assert.match(text.join("\n"), /tiles - resident/);
    assert.match(text.join("\n"), /decode p95 -/);
  });
});

describe("the HUD settings", () => {
  test("default to the top left corner and accept only the three free corners", () => {
    assert.equal(labDefaults.hudCorner, "tl");
    assert.equal(parseLabSettings(JSON.stringify({ hudCorner: "bl" })).hudCorner, "bl");
    assert.equal(parseLabSettings(JSON.stringify({ hudCorner: "br" })).hudCorner, "tl");
  });
});

describe("the HUD cost", () => {
  test("its own update work stays under 0.5 ms per frame", () => {
    const meter = createFrameMeter();
    const frames = 20_000;
    const refreshEvery = Math.round(hudRefreshMs / (1000 / 60));
    const input = {
      route: "viv" as const,
      residentTiles: 412,
      inflight: 6,
      decodeP95Ms: 4.2,
      atlasUsed: null,
      annotationsDrawn: 18_240,
      annotationsTotal: 100_000,
      lodTier: "tiered",
    };
    let sink = 0;
    let now = 0;
    for (let index = 0; index < 2000; index += 1) {
      now += 16.7;
      meter.record(now);
    }
    const started = performance.now();
    for (let index = 0; index < frames; index += 1) {
      now += 16.7;
      meter.record(now);
      if (index % refreshEvery === 0) {
        sink += hudLines({ ...input, frame: meter.summary() }).join("\n").length;
      }
    }
    const perFrame = (performance.now() - started) / frames;
    console.log(`HUD cost per frame: ${perFrame.toFixed(5)} ms (${frames} frames, ${sink} chars)`);
    assert.ok(perFrame < budgetMs, `HUD cost ${perFrame} ms is over ${budgetMs} ms`);
  });
});
