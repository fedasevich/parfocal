import assert from "node:assert/strict";
import { mock, test } from "node:test";
import {
  heardViewOf,
  sameCamera,
  stopFrame,
  throttle,
  viewFrame,
} from "../src/presence/follow-view.ts";

const camera = { x: 512, y: 384, zoom: 0.25 };

test("a view frame from a colleague is heard as a camera", () => {
  const heard = heardViewOf({ ...viewFrame(camera), user: "ben" }, "anna");
  assert.deepEqual(heard, { user: "ben", stop: false, camera });
});

test("a stop frame is heard as the end of sharing", () => {
  assert.deepEqual(heardViewOf({ ...stopFrame, user: "ben" }, "anna"), { user: "ben", stop: true });
});

test("my own frames, unsigned frames, other types and broken numbers are ignored", () => {
  assert.equal(heardViewOf({ ...viewFrame(camera), user: "anna" }, "anna"), null);
  assert.equal(heardViewOf(viewFrame(camera), "anna"), null);
  assert.equal(heardViewOf({ type: "event", user: "ben", x: 1, y: 2, zoom: 3 }, "anna"), null);
  assert.equal(heardViewOf({ type: "view", user: "ben", x: 1, y: "2", zoom: 3 }, "anna"), null);
  assert.equal(heardViewOf({ type: "view", user: "ben", x: 1, y: 2, zoom: null }, "anna"), null);
});

test("cameras are the same only when every number matches", () => {
  assert.equal(sameCamera(camera, { ...camera }), true);
  assert.equal(sameCamera(camera, { ...camera, zoom: 0.26 }), false);
  assert.equal(sameCamera(camera, { ...camera, x: 513 }), false);
});

test("the throttle sends the first call at once and one trailing call per window", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  let time = 1000;
  let runs = 0;
  const paced = throttle(
    () => {
      runs += 1;
    },
    50,
    () => time,
  );
  paced.call();
  assert.equal(runs, 1);
  time += 10;
  paced.call();
  paced.call();
  assert.equal(runs, 1);
  time += 40;
  mock.timers.tick(40);
  assert.equal(runs, 2);
  time += 60;
  paced.call();
  assert.equal(runs, 3);
  time += 10;
  paced.call();
  paced.cancel();
  mock.timers.tick(100);
  assert.equal(runs, 3);
  mock.timers.reset();
});
