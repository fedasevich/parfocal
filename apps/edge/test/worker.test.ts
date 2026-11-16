import assert from "node:assert/strict";
import { test } from "node:test";
import * as worker from "../src/worker.ts";

test("the Worker entry exports only the handler and its Durable Object classes, as workerd requires", () => {
  assert.deepEqual(Object.keys(worker).sort(), ["LoginCounter", "Room", "default"]);
  assert.equal(typeof worker.default.fetch, "function");
});
