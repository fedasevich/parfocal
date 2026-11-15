import assert from "node:assert/strict";
import { test } from "node:test";
import { selectWebClients } from "../src/clients.ts";
import { readConfig } from "../src/config.ts";
import {
  activeAfterInputMs,
  createFrameMonitor,
  type FrameSummary,
  framesPath,
  reportEveryMs,
  summarise,
} from "../src/telemetry/frame-monitor.ts";

function collector() {
  const reports: FrameSummary[] = [];
  return { reports, report: (summary: FrameSummary) => reports.push(summary) };
}

test("a summary holds counts and percentiles and nothing that names a slide", () => {
  const summary = summarise("viv", [16, 17, 16, 18, 60, 16, 17, 16, 16, 120]);
  assert.deepEqual(summary, {
    renderer: "viv",
    frames: 10,
    p50_ms: 16,
    p95_ms: 120,
    long_frames: 2,
  });
  assert.equal(summarise("viv", []), null);
});

test("frames are timed only right after the reader moves the slide", () => {
  const sink = collector();
  const monitor = createFrameMonitor("viv", sink);
  assert.equal(monitor.frame(0), false);
  monitor.input(100);
  assert.equal(monitor.frame(110), true);
  assert.equal(monitor.frame(126), true);
  assert.equal(monitor.frame(150), true);
  assert.equal(monitor.frame(100 + activeAfterInputMs + 1), false);
  monitor.flush();
  assert.deepEqual(
    sink.reports.map((report) => report.frames),
    [2],
  );
});

test("an idle viewer reports nothing, so it never wakes the API", () => {
  const sink = collector();
  const monitor = createFrameMonitor("viv", sink);
  for (let at = 0; at < 3 * reportEveryMs; at += 16) monitor.frame(at);
  monitor.flush();
  assert.deepEqual(sink.reports, []);
});

test("a long pan reports once a minute", () => {
  const sink = collector();
  const monitor = createFrameMonitor("deck-webgpu", sink);
  for (let at = 0; at <= reportEveryMs + 32; at += 16) {
    monitor.input(at);
    monitor.frame(at);
  }
  assert.equal(sink.reports.length, 1);
  assert.equal(sink.reports[0]?.renderer, "deck-webgpu");
});

test("only production sends frame summaries, by beacon to the API", async () => {
  const sent: [string, Blob][] = [];
  const beacon = (path: string, body: Blob) => sent.push([path, body]) > 0;
  const summary = summarise("viv", [16, 16]);
  assert.ok(summary);
  const dev = selectWebClients(
    readConfig({ PARFOCAL_PUBLIC_APP_ENV: "dev" }),
    {},
    {},
    undefined,
    beacon,
  );
  const debug = console.debug;
  console.debug = () => {};
  try {
    dev.frames.report(summary);
  } finally {
    console.debug = debug;
  }
  assert.equal(sent.length, 0);
  const prod = selectWebClients(
    readConfig({ PARFOCAL_PUBLIC_APP_ENV: "prod" }),
    {},
    {},
    undefined,
    beacon,
  );
  prod.frames.report(summary);
  const [[path, body]] = sent as [[string, Blob]];
  assert.equal(path, framesPath);
  assert.deepEqual(JSON.parse(await body.text()), summary);
});
