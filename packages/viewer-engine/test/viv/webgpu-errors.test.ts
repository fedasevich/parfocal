import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type DeviceLostInfoLike,
  type GpuErrorFilter,
  type UncapturedErrorEventLike,
  type WebGpuDeviceLike,
  type WebGpuError,
  watchWebGpuDevice,
  withErrorScopes,
} from "../../src/viv/webgpu-errors.ts";

function fakeDevice(popped: ({ message: string } | null)[] = []) {
  const listeners = new Set<(event: UncapturedErrorEventLike) => void>();
  const calls: string[] = [];
  let resolveLost: (info: DeviceLostInfoLike) => void = () => {};
  const lost = new Promise<DeviceLostInfoLike>((resolve) => {
    resolveLost = resolve;
  });
  const device: WebGpuDeviceLike = {
    lost,
    addEventListener: (_type, listener) => {
      listeners.add(listener);
    },
    removeEventListener: (_type, listener) => {
      listeners.delete(listener);
    },
    pushErrorScope: (filter: GpuErrorFilter) => {
      calls.push(`push ${filter}`);
    },
    popErrorScope: () => {
      calls.push("pop");
      return Promise.resolve(popped.shift() ?? null);
    },
  };
  return {
    device,
    listeners,
    calls,
    loseDevice: (info: DeviceLostInfoLike) => resolveLost(info),
    raise: (message: string) => {
      const state = { prevented: false };
      for (const listener of [...listeners]) {
        listener({
          error: { message },
          preventDefault: () => {
            state.prevented = true;
          },
        });
      }
      return state;
    },
  };
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

test("uncaptured errors are counted, reported and kept out of the console", () => {
  const fake = fakeDevice();
  const seen: WebGpuError[] = [];
  const watch = watchWebGpuDevice(fake.device, { onError: (error) => seen.push(error) });
  assert.equal(watch.uncaptured(), 0);
  const state = fake.raise("buffer too large");
  assert.equal(state.prevented, true);
  fake.raise("bad bind group");
  assert.equal(watch.uncaptured(), 2);
  assert.deepEqual(
    seen.map((error) => [error.source, error.message]),
    [
      ["uncaptured", "buffer too large"],
      ["uncaptured", "bad bind group"],
    ],
  );
  watch.stop();
});

test("stopping removes the listener and silences a later loss", async () => {
  const fake = fakeDevice();
  const seen: WebGpuError[] = [];
  const watch = watchWebGpuDevice(fake.device, { onError: (error) => seen.push(error) });
  assert.equal(fake.listeners.size, 1);
  watch.stop();
  watch.stop();
  assert.equal(fake.listeners.size, 0);
  fake.raise("late");
  fake.loseDevice({ reason: "unknown", message: "gpu crashed" });
  await settle();
  assert.deepEqual(seen, []);
  assert.equal(watch.uncaptured(), 0);
});

test("a lost device is reported unless the loss was a deliberate destroy", async () => {
  const lost = fakeDevice();
  const seen: WebGpuError[] = [];
  watchWebGpuDevice(lost.device, { onError: (error) => seen.push(error) });
  lost.loseDevice({ reason: "unknown", message: "gpu crashed" });
  await settle();
  assert.equal(seen.length, 1);
  assert.equal(seen[0]?.source, "device-lost");
  assert.equal(seen[0]?.message, "gpu crashed");

  const destroyed = fakeDevice();
  const ignored: WebGpuError[] = [];
  watchWebGpuDevice(destroyed.device, { onError: (error) => ignored.push(error) });
  destroyed.loseDevice({ reason: "destroyed", message: "destroy()" });
  await settle();
  assert.deepEqual(ignored, []);
});

test("error scopes are pushed in order and popped in reverse, and errors name their filter", async () => {
  const fake = fakeDevice([null, { message: "out of memory" }, { message: "invalid pipeline" }]);
  const outcome = await withErrorScopes(fake.device, () => 42);
  assert.equal(outcome.result, 42);
  assert.deepEqual(fake.calls, [
    "push validation",
    "push out-of-memory",
    "push internal",
    "pop",
    "pop",
    "pop",
  ]);
  assert.deepEqual(
    outcome.errors.map((error) => [error.source, error.filter, error.message]),
    [
      ["scope", "out-of-memory", "out of memory"],
      ["scope", "validation", "invalid pipeline"],
    ],
  );
});

test("a scoped run that throws still pops every scope and rethrows", async () => {
  const fake = fakeDevice();
  await assert.rejects(
    withErrorScopes(fake.device, () => {
      throw new Error("draw failed");
    }, ["validation"]),
    /draw failed/,
  );
  assert.deepEqual(fake.calls, ["push validation", "pop"]);
});

test("an async scoped run waits for the work before popping", async () => {
  const fake = fakeDevice();
  const outcome = await withErrorScopes(fake.device, async () => {
    await settle();
    fake.calls.push("work");
    return "done";
  }, ["internal"]);
  assert.equal(outcome.result, "done");
  assert.deepEqual(fake.calls, ["push internal", "work", "pop"]);
  assert.deepEqual(outcome.errors, []);
});
