import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { bindShiftRefresh } from "../src/annotations/shift-refresh.ts";

class FakeKeyboardEvent {
  readonly type: string;
  readonly key: string;
  constructor(type: string, key: string) {
    this.type = type;
    this.key = key;
  }
}

function fakeTarget() {
  const listeners = new Map<string, ((event: Event) => void)[]>();
  const target = {
    addEventListener: (type: string, listener: (event: Event) => void) =>
      listeners.set(type, [...(listeners.get(type) ?? []), listener]),
    removeEventListener: (type: string, listener: (event: Event) => void) =>
      listeners.set(
        type,
        (listeners.get(type) ?? []).filter((item) => item !== listener),
      ),
  };
  const fire = (type: string, key: string) => {
    for (const listener of listeners.get(type) ?? []) {
      listener(new FakeKeyboardEvent(type, key) as unknown as Event);
    }
  };
  return { target, fire, count: () => [...listeners.values()].flat().length };
}

describe("Shift pressed or released mid drag refreshes the end", () => {
  (globalThis as { KeyboardEvent?: unknown }).KeyboardEvent = FakeKeyboardEvent;

  test("pressing Shift reports held and releasing it reports free", () => {
    const { target, fire } = fakeTarget();
    const seen: boolean[] = [];
    bindShiftRefresh(target, (held) => seen.push(held));
    fire("keydown", "Shift");
    fire("keyup", "Shift");
    assert.deepEqual(seen, [true, false]);
  });

  test("other keys are ignored and unbinding removes both listeners", () => {
    const { target, fire, count } = fakeTarget();
    const seen: boolean[] = [];
    const unbind = bindShiftRefresh(target, (held) => seen.push(held));
    fire("keydown", "a");
    fire("keyup", "Alt");
    assert.deepEqual(seen, []);
    assert.equal(count(), 2);
    unbind();
    assert.equal(count(), 0);
  });
});
