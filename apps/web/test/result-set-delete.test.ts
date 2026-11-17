import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError } from "@parfocal/api-client";
import { deleteFailure } from "../src/screens/project/result-set-delete-model.ts";

const problem = (status: number, code: string, title: string, detail?: string) => ({
  type: "about:blank",
  title,
  status,
  code,
  ...(detail === undefined ? {} : { detail }),
});

test("a result set used by review asks for a second confirm and shows its use", () => {
  const error = new ApiError(
    "conflict",
    409,
    problem(
      409,
      "result-set-in-review",
      "Review work uses this result set",
      "Used by 1 review task",
    ),
  );
  assert.deepEqual(deleteFailure(error), { needsConfirm: true, text: "Used by 1 review task" });
});

test("any other refusal shows its title and does not offer a second confirm", () => {
  const error = new ApiError(
    "forbidden",
    403,
    problem(403, "uploading-not-allowed", "Only an owner"),
  );
  assert.deepEqual(deleteFailure(error), { needsConfirm: false, text: "Only an owner" });
});

test("a network failure says the server could not be reached", () => {
  assert.deepEqual(deleteFailure(new ApiError("network", 0)), {
    needsConfirm: false,
    text: "Could not reach the server. Try again.",
  });
  assert.equal(deleteFailure(new Error("boom")).needsConfirm, false);
});
