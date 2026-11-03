import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultFormat, formatFor } from "../src/format.ts";

test("a language and lengths setting always gives the same formatter", () => {
  assert.equal(formatFor("en", "auto"), defaultFormat);
  assert.equal(formatFor("cs", "um"), formatFor("cs", "um"));
  assert.notEqual(formatFor("en", "um"), defaultFormat);
});

test("the default formatter reads sizes the way the screens already did", () => {
  assert.equal(defaultFormat.size(0.45), "0.45 mm");
  assert.equal(defaultFormat.size(3.26), "3.3 mm");
  assert.equal(formatFor("en", "um").size(0.45), "450 µm");
});
