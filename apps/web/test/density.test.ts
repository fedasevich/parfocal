import assert from "node:assert/strict";
import { test } from "node:test";
import { applyDensity } from "../src/shell/density.ts";

test("the density setting writes data-density on the root like data-motion", () => {
  const root = { dataset: {} as Record<string, string> } as unknown as HTMLElement;
  applyDensity("compact", root);
  assert.equal(root.dataset["density"], "compact");
  applyDensity("comfortable", root);
  assert.equal(root.dataset["density"], "comfortable");
});
