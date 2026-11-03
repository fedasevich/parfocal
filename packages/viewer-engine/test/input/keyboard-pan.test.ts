import assert from "node:assert/strict";
import { test } from "node:test";
import {
  advanceKeyPan,
  cameraProfiles,
  createKeyPan,
  keyPanCruisePxPerMs,
  keyZoomOctaves,
  restingKeyPan,
} from "../../src/index.ts";

function harness(profile = cameraProfiles.smooth) {
  let time = 0;
  let queued: (() => void) | null = null;
  const moves: [number, number][] = [];
  const pan = createKeyPan({
    panBy: (dx, dy) => moves.push([dx, dy]),
    profile: () => profile,
    now: () => time,
    frames: {
      request: (callback) => {
        queued = callback;
        return 1;
      },
      cancel: () => {
        queued = null;
      },
    },
  });
  const run = (ms: number) => {
    const end = time + ms;
    while (queued !== null && time < end) {
      time += 16;
      const callback: () => void = queued;
      queued = null;
      callback();
    }
    time = Math.max(time, end);
  };
  const total = () =>
    moves.reduce(([x, y], [dx, dy]) => [x + dx, y + dy] as [number, number], [0, 0]);
  const speed = () => {
    const [dx, dy] = moves.at(-1) ?? [0, 0];
    return Math.hypot(dx, dy) / 16;
  };
  return { pan, run, total, speed, moves, pending: () => queued !== null };
}

test("plus and minus zoom by 1.35 times", () => {
  assert.ok(Math.abs(2 ** keyZoomOctaves - 1.35) < 1e-12);
});

test("a held arrow eases up to cruise speed instead of stepping", () => {
  const { pan, run, speed } = harness();
  pan.press("right");
  run(16);
  const first = speed();
  run(200);
  const middle = speed();
  run(1000);
  const cruise = keyPanCruisePxPerMs(cameraProfiles.smooth, false);
  assert.ok(first > 0 && first < cruise / 3, `${first}`);
  assert.ok(middle > first && middle < cruise);
  assert.ok(Math.abs(speed() - cruise) < cruise * 0.01);
});

test("right moves the content left and up moves it down", () => {
  const right = harness();
  right.pan.press("right");
  right.run(500);
  assert.ok(right.total()[0] < 0);
  assert.equal(right.total()[1], 0);
  const up = harness();
  up.pan.press("up");
  up.run(500);
  assert.ok(up.total()[1] > 0);
});

test("Shift pans three times faster", () => {
  const slow = harness();
  slow.pan.press("left");
  slow.run(2000);
  const fast = harness();
  fast.pan.press("left", true);
  fast.run(2000);
  assert.ok(Math.abs(fast.speed() / slow.speed() - 3) < 0.01);
});

test("two arrows pan diagonally at the same speed as one", () => {
  const { pan, run, speed, moves } = harness();
  pan.press("up");
  pan.press("left");
  run(2000);
  const [dx, dy] = moves.at(-1) ?? [0, 0];
  assert.ok(Math.abs(dx - dy) < 1e-9);
  assert.ok(Math.abs(speed() - keyPanCruisePxPerMs(cameraProfiles.smooth, false)) < 0.01);
});

test("release eases out and then stops asking for frames", () => {
  const { pan, run, speed, pending } = harness();
  pan.press("down");
  run(1000);
  const cruise = speed();
  pan.release("down");
  run(32);
  assert.ok(speed() > 0 && speed() < cruise);
  run(3000);
  assert.equal(pan.moving(), false);
  assert.equal(pending(), false);
});

test("the Instant profile starts at speed and stops on release", () => {
  const { pan, run, speed, pending } = harness(cameraProfiles.instant);
  pan.press("right");
  run(16);
  assert.equal(speed(), keyPanCruisePxPerMs(cameraProfiles.instant, false));
  pan.release("right");
  run(16);
  assert.equal(pan.moving(), false);
  assert.equal(pending(), false);
});

test("a long frame gap does not jump the camera", () => {
  const cruise = keyPanCruisePxPerMs(cameraProfiles.instant, false);
  const step = advanceKeyPan({ ...restingKeyPan, held: ["left"] }, cameraProfiles.instant, 5000);
  assert.equal(step.dx, cruise * 100);
});

test("stop drops held keys and the pending frame", () => {
  const { pan, run, pending } = harness();
  pan.press("up");
  run(100);
  pan.stop();
  assert.equal(pan.moving(), false);
  assert.equal(pending(), false);
});
