import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { shellStore } from "../src/shell/shell-store.ts";

afterEach(() => shellStore.reset());

test("the new project drawer starts closed, opens from the shell store and resets closed", () => {
  assert.equal(shellStore.getState().newProjectOpen, false);
  shellStore.setState({ newProjectOpen: true });
  assert.equal(shellStore.getState().newProjectOpen, true);
  shellStore.reset();
  assert.equal(shellStore.getState().newProjectOpen, false);
});
