import assert from "node:assert/strict";
import { test } from "node:test";
import { keyRegistry } from "../src/keys/catalogue.ts";
import { idleKeys, step } from "../src/keys/registry.ts";
import { brightnessAfterKey, brightnessKeyIds } from "../src/viewer/slide-brightness.ts";

test("Alt+Up and Alt+Down step by 10 and stop at 20 and 140", () => {
  assert.equal(brightnessAfterKey("brightup", 100), 110);
  assert.equal(brightnessAfterKey("brightdown", 100), 90);
  assert.equal(brightnessAfterKey("brightup", 135), 140);
  assert.equal(brightnessAfterKey("brightup", 140), 140);
  assert.equal(brightnessAfterKey("brightdown", 25), 20);
  assert.equal(brightnessAfterKey("brightdown", 20), 20);
});

test("Alt+0 resets to 100 from either side", () => {
  assert.equal(brightnessAfterKey("brightreset", 40), 100);
  assert.equal(brightnessAfterKey("brightreset", 130), 100);
});

test("Alt+0 fires the reset and plain 0 does not", () => {
  const bindings = keyRegistry.bindings({ scopes: ["viewer"], only: brightnessKeyIds });
  const fire = (altKey: boolean) =>
    step(bindings, idleKeys, {
      type: "down",
      key: altKey ? "º" : "0",
      code: "Digit0",
      altKey,
      at: 0,
    }).fired.map((fired) => fired.action);
  assert.deepEqual(fire(true), ["brightreset"]);
  assert.deepEqual(fire(false), []);
});

test("Alt+Up and Alt+Down reach the brightness actions", () => {
  const bindings = keyRegistry.bindings({ scopes: ["viewer"], only: brightnessKeyIds });
  const fire = (key: string) =>
    step(bindings, idleKeys, { type: "down", key, code: key, altKey: true, at: 0 }).fired.map(
      (fired) => fired.action,
    );
  assert.deepEqual(fire("ArrowUp"), ["brightup"]);
  assert.deepEqual(fire("ArrowDown"), ["brightdown"]);
});

test("setting the brightness tells every listener and a later read sees it", async () => {
  const { setSlideBrightness, subscribeToSlideBrightness, readSlideBrightness } = await import(
    "../src/viewer/slide-brightness.ts"
  );
  const seen: number[] = [];
  const stop = subscribeToSlideBrightness(() => seen.push(readSlideBrightness()));
  setSlideBrightness(70);
  setSlideBrightness(100);
  stop();
  setSlideBrightness(80);
  assert.deepEqual(seen, [70, 100]);
  assert.equal(readSlideBrightness(), 80);
  setSlideBrightness(100);
});
