import assert from "node:assert/strict";
import { test } from "node:test";
import { lazyText } from "../src/lib/lazy-text.ts";

test("a lazy text made before the locale is set does not throw and reads later", () => {
  let ready = false;
  const labels = lazyText(() => {
    if (!ready) throw new Error("no locale yet");
    return { away: "Away" };
  });
  ready = true;
  assert.equal(labels.away, "Away");
});

test("a lazy list made before the locale is set still maps its items later", () => {
  let ready = false;
  const items = lazyText(() => {
    if (!ready) throw new Error("no locale yet");
    return ["first", "second"];
  });
  ready = true;
  assert.deepEqual(
    items.map((item) => item.toUpperCase()),
    ["FIRST", "SECOND"],
  );
});
