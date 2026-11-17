import assert from "node:assert/strict";
import { test } from "node:test";
import { captureFrame, type DomNodeLike, serialiseNode } from "../src/study/trace/dom-frames.ts";
import {
  cursorAt,
  deadClicks,
  documentHtml,
  hasFrames,
  loggedKey,
  maskGlyph,
  mergeBatches,
  reloads,
  screenAt,
  type TraceEvent,
  taskSpans,
  wireframeAt,
} from "../src/study/trace/trace-model.ts";
import { createBatcher, memorySink, type Schedule } from "../src/study/trace/trace-store.ts";

const secret = "Jane Doe 1970-01-01";

const text = (value: string): DomNodeLike => ({
  nodeType: 3,
  nodeName: "#text",
  nodeValue: value,
  childNodes: [],
});

const element = (
  name: string,
  attributes: Record<string, string>,
  children: DomNodeLike[] = [],
): DomNodeLike => ({
  nodeType: 1,
  nodeName: name.toUpperCase(),
  nodeValue: null,
  childNodes: children,
  attributes: Object.entries(attributes).map(([key, value]) => ({ name: key, value })),
});

const page = (...children: DomNodeLike[]) => {
  const body = element("body", {}, children);
  return captureFrame({
    body,
    documentElement: element("html", { class: "dark" }),
    defaultView: { scrollX: 0, scrollY: 3 },
  });
};

const everything = (frame: unknown) => JSON.stringify(frame);

test("typed values never reach a frame", () => {
  const frame = page(
    element("input", { type: "text", value: secret, placeholder: "Name" }),
    element("textarea", { "aria-label": secret }, [text(secret)]),
    element("div", { contenteditable: "true" }, [element("span", {}, [text(secret)])]),
    element("div", { "data-private": "" }, [text(secret)]),
    element("div", { role: "textbox", title: secret }, [text(secret)]),
    element("input", { type: "password", value: secret }),
  );
  assert.ok(frame);
  assert.ok(!everything(frame).includes("Jane"));
  assert.ok(!everything(frame).includes("1970"));
  assert.ok(everything(frame).includes(maskGlyph));
  assert.ok(!documentHtml({ load: undefined, path: "/", frame }, "http://x").includes("Jane"));
});

test("fields are marked masked and plain text outside fields is kept", () => {
  const frame = page(
    element("input", { type: "text", value: secret }),
    element("p", {}, [text("Open the slide")]),
  );
  assert.ok(everything(frame).includes('"data-masked":"true"'));
  assert.ok(everything(frame).includes("Open the slide"));
});

test("scripts, handlers and data urls are dropped", () => {
  const node = serialiseNode(
    element("div", { onclick: "steal()", id: "a" }, [
      element("script", {}, [text("steal()")]),
      element("img", { src: "data:image/png;base64,AAAA" }),
    ]),
  );
  assert.ok(node && typeof node !== "string");
  const dump = JSON.stringify(node);
  assert.ok(!dump.includes("steal"));
  assert.ok(!dump.includes("base64"));
  assert.ok(dump.includes('"id":"a"'));
});

test("printable keys inside a text field are masked and named keys are kept", () => {
  assert.equal(loggedKey("a", true), maskGlyph);
  assert.equal(loggedKey(" ", true), maskGlyph);
  assert.equal(loggedKey("g", false), "g");
  assert.equal(loggedKey(" ", false), "Space");
  assert.equal(loggedKey("Enter", true), "Enter");
});

const log: TraceEvent[] = [
  { t: 1000, k: "load", path: "/a", reload: false, w: 1000, h: 500, head: ["<link>"] },
  { t: 1100, k: "task", taskId: "t1", edge: "start" },
  { t: 1200, k: "move", x: 10, y: 20 },
  { t: 1300, k: "click", x: 11, y: 21, target: "button[save]", interactive: true },
  { t: 1400, k: "mutation" },
  {
    t: 1500,
    k: "frame",
    frame: { body: ["body", {}, ["x"]], rootAttrs: {}, scrollX: 0, scrollY: 0 },
  },
  { t: 2000, k: "click", x: 50, y: 60, target: "button[dead]", interactive: true },
  { t: 2100, k: "click", x: 5, y: 5, target: "div", interactive: false },
  { t: 3000, k: "task", taskId: "t1", edge: "end", outcome: "done" },
  { t: 3100, k: "task", taskId: "t2", edge: "start" },
  { t: 3200, k: "load", path: "/a", reload: true, w: 1000, h: 500, head: [] },
  { t: 3300, k: "route", path: "/b" },
  { t: 5000, k: "key", key: "g" },
];

test("task spans run from start to end and the last one stays open to the end", () => {
  const spans = taskSpans(log);
  assert.deepEqual(
    spans.map((span) => [span.taskId, span.from, span.to, span.outcome]),
    [
      ["t1", 100, 2000, "done"],
      ["t2", 2100, 4000, undefined],
    ],
  );
});

test("a dead click is an interactive click with no reaction in the next 800 ms", () => {
  assert.deepEqual(deadClicks(log), [1000]);
});

test("a click near the end of the log is not judged", () => {
  const short: TraceEvent[] = [
    { t: 0, k: "load", path: "/", reload: false, w: 1, h: 1, head: [] },
    { t: 100, k: "click", x: 0, y: 0, target: "button", interactive: true },
    { t: 300, k: "key", key: "a" },
  ];
  assert.deepEqual(deadClicks(short), []);
});

test("reloads are the loads that came from a reload", () => {
  assert.deepEqual(reloads(log), [2200]);
});

test("the screen and wireframe at a time follow loads, routes and clicks", () => {
  assert.equal(screenAt(log, 400).frame, undefined);
  assert.ok(screenAt(log, 600).frame);
  assert.equal(screenAt(log, 2400).path, "/b");
  assert.equal(screenAt(log, 2400).frame, undefined);
  const wire = wireframeAt(log, 1200);
  assert.equal(wire.path, "/a");
  assert.equal(wire.marks.length, 3);
  assert.equal(wireframeAt(log, 2400).marks.length, 0);
  assert.deepEqual(cursorAt(log, 250), { x: 10, y: 20 });
  assert.equal(hasFrames(log), true);
  assert.equal(hasFrames(log.filter((event) => event.k !== "frame")), false);
});

test("batches merge back in order", () => {
  const merged = mergeBatches([
    { sessionId: "s", index: 1, events: [{ t: 5, k: "mutation" }] },
    { sessionId: "s", index: 0, events: [{ t: 1, k: "mutation" }] },
  ]);
  assert.deepEqual(
    merged.map((event) => event.t),
    [1, 5],
  );
});

test("the batcher uploads at flushes and on the minute, never per event", async () => {
  const sink = memorySink();
  let tick: () => void = () => undefined;
  const schedule: Schedule = (run) => {
    tick = run;
    return () => undefined;
  };
  const batcher = createBatcher("s1", sink, schedule, 60_000);
  for (let index = 0; index < 50; index += 1) batcher.push({ t: index, k: "mutation" });
  assert.equal(sink.batches.length, 0);
  await batcher.flush();
  assert.equal(sink.batches.length, 1);
  assert.equal(sink.batches[0]?.events.length, 50);
  await batcher.flush();
  assert.equal(sink.batches.length, 1);
  batcher.push({ t: 99, k: "mutation" });
  tick();
  await batcher.flush();
  assert.equal(sink.batches.length, 2);
  assert.equal(sink.batches[1]?.index, 1);
  batcher.push({ t: 100, k: "mutation" });
  await batcher.stop();
  assert.equal(sink.batches.length, 3);
});
