import assert from "node:assert/strict";
import { test } from "node:test";
import { maskNames } from "../src/shell/hide-names.ts";

test("hiding names swaps display names for initials at any depth and leaves the rest", () => {
  const input = {
    data: [
      { user_id: "u1", display_name: "Lenka Malá", initials: "LM", title: "Pathologist" },
      { nested: { author: { display_name: "Jan Novák", initials: "JN" } } },
    ],
    name: "Breast panel",
    count: 2,
  };
  assert.deepEqual(maskNames(input), {
    data: [
      { user_id: "u1", display_name: "LM", initials: "LM", title: "Pathologist" },
      { nested: { author: { display_name: "JN", initials: "JN" } } },
    ],
    name: "Breast panel",
    count: 2,
  });
  assert.equal(input.data[0]?.display_name, "Lenka Malá");
  assert.equal(maskNames(null), null);
});
