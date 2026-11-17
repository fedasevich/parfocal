import assert from "node:assert/strict";
import { test } from "node:test";
import { copyAction, copyOutcome } from "../src/viewer/remote-copy.ts";

test("the copy button shows only on a remote slide for someone who may upload", () => {
  assert.equal(copyAction(null, true), "hidden");
  assert.equal(copyAction({ storage: "uploaded", offline: false }, true), "hidden");
  assert.equal(copyAction({ storage: "remote", offline: false }, false), "hidden");
  assert.equal(copyAction({ storage: "remote", offline: false }, true), "ready");
});

test("the copy button is held while the source is not answering", () => {
  assert.equal(copyAction({ storage: "remote", offline: true }, true), "offline");
});

test("the copy answer becomes a plain outcome", () => {
  assert.equal(copyOutcome({ status: 202, data: { job_id: "j1" } }), "queued");
  assert.equal(copyOutcome({ status: 409, data: { code: "slide-not-remote" } }), "already-copied");
  assert.equal(copyOutcome({ status: 409, data: { code: "remote-slide-not-ready" } }), "not-ready");
  assert.equal(copyOutcome({ status: 403, data: { code: "forbidden" } }), "failed");
  assert.equal(copyOutcome({ status: 500, data: null }), "failed");
});
