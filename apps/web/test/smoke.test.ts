import assert from "node:assert/strict";
import { test } from "node:test";
import { packageName, workspaceDependencies } from "../src/index.ts";

test("@parfocal/web loads", () => {
  assert.equal(packageName, "@parfocal/web");
});

test("@parfocal/web resolves its workspace dependencies", () => {
  assert.deepEqual(workspaceDependencies, [
    "@parfocal/api-client",
    "@parfocal/tokens",
    "@parfocal/ui",
    "@parfocal/viewer-engine",
  ]);
});
