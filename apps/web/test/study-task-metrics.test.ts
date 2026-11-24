import assert from "node:assert/strict";
import { test } from "node:test";
import { type MeterEvent, scoreTask } from "../src/study/task-metrics.ts";
import {
  deadClicks,
  silentControlClicks,
  type TraceEvent,
} from "../src/study/trace/trace-model.ts";

const press = (t: number, control: boolean): MeterEvent => ({ k: "press", t, control });

const click = (t: number, pressedAt: number, control: boolean, dragged = false): MeterEvent => ({
  k: "click",
  t,
  pressedAt,
  control,
  dragged,
});

const task: MeterEvent[] = [
  { k: "change", t: 100 },
  { k: "wheel", t: 900 },
  { k: "key", t: 1200, field: false },
  press(2000, false),
  click(2080, 2000, false),
  press(3000, true),
  click(3080, 3000, true),
  press(4000, false),
  { k: "change", t: 4050 },
  click(4100, 4000, false),
  press(5000, false),
  click(5600, 5000, false, true),
  press(6000, false),
  click(6080, 6000, false),
  { k: "change", t: 6500 },
  { k: "key", t: 7000, field: true },
  { k: "key", t: 8000, field: false },
  { k: "change", t: 8100 },
  press(9000, false),
  click(9080, 9000, false),
  press(9500, true),
  click(9560, 9500, true),
];

test("round 4 dead clicks and first action on a fixed trace match a hand count", () => {
  const score = scoreTask(task, 0, 9600);
  assert.deepEqual(score.counts, {
    clicks: 7,
    deadClicks: 1,
    silentControlClicks: 1,
    keys: 2,
    wheels: 1,
  });
  assert.equal(score.timeToFirstActionMs, 3080);
  assert.equal(score.timeToFirstInputMs, 900);
});

test("a click still inside its window is not judged dead", () => {
  const score = scoreTask(task, 0, 9600);
  assert.equal(score.counts.deadClicks, 1);
  const later = scoreTask(task, 0, 20_000);
  assert.equal(later.counts.deadClicks, 2);
  assert.equal(later.counts.silentControlClicks, 2);
});

test("a key the page reacted to is the first action when no click came before", () => {
  const keyFirst: MeterEvent[] = [
    { k: "key", t: 500, field: false },
    { k: "key", t: 1500, field: false },
    { k: "change", t: 1700 },
    press(3000, true),
    click(3050, 3000, true),
  ];
  assert.equal(scoreTask(keyFirst, 200, 9000).timeToFirstActionMs, 1300);
});

test("a task with only dead clicks has no first action", () => {
  const onlyDead: MeterEvent[] = [press(1000, false), click(1050, 1000, false)];
  const score = scoreTask(onlyDead, 0, 5000);
  assert.equal(score.counts.deadClicks, 1);
  assert.equal(score.timeToFirstActionMs, null);
  assert.equal(score.timeToFirstInputMs, 1000);
});

test("the replay marks round 4 dead clicks and the earlier silent control presses", () => {
  const log: TraceEvent[] = [
    { t: 0, k: "load", path: "/", reload: false, w: 1, h: 1, head: [] },
    { t: 1000, k: "click", x: 0, y: 0, target: "div", interactive: false, held: 80 },
    { t: 2000, k: "click", x: 0, y: 0, target: "button", interactive: true, held: 80 },
    { t: 2950, k: "mutation" },
    { t: 3000, k: "click", x: 0, y: 0, target: "div", interactive: false, held: 80 },
    { t: 4000, k: "click", x: 0, y: 0, target: "canvas", interactive: false, dragged: true },
    { t: 5000, k: "click", x: 0, y: 0, target: "div", interactive: false },
    { t: 5300, k: "route", path: "/b" },
    { t: 9000, k: "key", key: "a" },
  ];
  assert.deepEqual(deadClicks(log), [1000]);
  assert.deepEqual(silentControlClicks(log), [2000]);
});

test("a click on the slide that only moved the camera reacted", () => {
  const camera = { slide: "s", x: 1, y: 2, zoom: 1, w: 10, h: 10, vw: 5, vh: 5 };
  const log: TraceEvent[] = [
    { t: 0, k: "load", path: "/", reload: false, w: 1, h: 1, head: [] },
    { t: 1000, k: "click", x: 0, y: 0, target: "canvas", interactive: false, held: 60 },
    { t: 1250, k: "camera", ...camera },
    { t: 3000, k: "key", key: "a" },
  ];
  assert.deepEqual(deadClicks(log), []);
});
