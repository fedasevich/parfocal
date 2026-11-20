import assert from "node:assert/strict";
import { test } from "node:test";
import { unknownValuesOf } from "../src/search/unknown-values.ts";
import { hasSession } from "../src/session/sign-in-redirect.ts";

test("only values outside the known list are named", () => {
  const allowed = { mode: ["look", "review"], tab: ["slides", "tasks"] };
  assert.deepEqual(unknownValuesOf("?mode=banana&tab=slides", allowed), ["mode"]);
  assert.deepEqual(unknownValuesOf("?mode=look", allowed), []);
  assert.deepEqual(unknownValuesOf("", allowed), []);
});

test("the sign-in page only sends a person home when a real session exists", async () => {
  const ok = () => Promise.resolve({ status: 200, data: {} });
  const refused = () => Promise.reject(new Error("401"));
  assert.equal(await hasSession("off", ok), true);
  assert.equal(await hasSession("off", refused), false);
  assert.equal(await hasSession("all", ok), false);
});
