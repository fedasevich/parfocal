import assert from "node:assert/strict";
import { test } from "node:test";
import { dotJoin } from "../src/screens/format.ts";

test("empty parts leave no double separator", () => {
  assert.equal(
    dotJoin(["Argos-1.avs", "", "Scanner format comparison"]),
    "Argos-1.avs · Scanner format comparison",
  );
  assert.equal(dotJoin(["a", null, undefined, " ", "b", "c"]), "a · b · c");
  assert.equal(dotJoin([]), "");
});
