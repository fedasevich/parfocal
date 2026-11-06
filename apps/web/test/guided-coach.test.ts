import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { hasSeenGuidedCoach, markGuidedCoachSeen } from "../src/screens/review/guided-coach.ts";

const memory = new Map<string, string>();
let changes = 0;

beforeEach(() => {
  memory.clear();
  changes = 0;
  const storage = {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => void memory.set(key, value),
  };
  Object.assign(globalThis, {
    window: {
      localStorage: storage,
      dispatchEvent: () => {
        changes += 1;
        return true;
      },
      addEventListener: () => {},
    },
  });
});

test("nobody has seen the tips before", () => {
  assert.equal(hasSeenGuidedCoach("user-a"), false);
  assert.equal(hasSeenGuidedCoach(undefined), false);
});

test("dismissing the tips is remembered for that user only", () => {
  markGuidedCoachSeen("user-a");
  assert.equal(hasSeenGuidedCoach("user-a"), true);
  assert.equal(hasSeenGuidedCoach("user-b"), false);
  assert.equal(changes, 1);
});

test("a second user still sees the tips after the first dismissed them", () => {
  markGuidedCoachSeen("user-a");
  markGuidedCoachSeen("user-b");
  assert.equal(hasSeenGuidedCoach("user-a"), true);
  assert.equal(hasSeenGuidedCoach("user-b"), true);
  assert.equal(hasSeenGuidedCoach("user-c"), false);
});

test("a signed-out visitor is kept apart from every user", () => {
  markGuidedCoachSeen(undefined);
  assert.equal(hasSeenGuidedCoach(undefined), true);
  assert.equal(hasSeenGuidedCoach("user-a"), false);
});

test("damaged storage reads as not seen and does not throw", () => {
  memory.set("parfocal.guided-coach", "{not json");
  assert.equal(hasSeenGuidedCoach("user-a"), false);
  memory.set("parfocal.guided-coach", "[1,2]");
  assert.equal(hasSeenGuidedCoach("user-a"), false);
});
