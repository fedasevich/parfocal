import assert from "node:assert/strict";
import { test } from "node:test";
import {
  decodeHints,
  encodeHints,
  type FileIdentity,
  interruptedEntry,
  retryDelaysMs,
  sameFile,
  startedEntry,
  withDone,
  withError,
  withManualRetry,
  withPause,
  withProgress,
} from "../src/upload/entries.ts";

const identity: FileIdentity = {
  projectId: "p1",
  caseId: "c1",
  name: "slide-1g.bin",
  size: 1_073_741_824,
  lastModified: 1_700_000_000_000,
};

test("a file is the same file when project, name, size and modified time match", () => {
  assert.ok(sameFile(identity, { ...identity, caseId: null }));
  assert.ok(!sameFile(identity, { ...identity, lastModified: 1 }));
  assert.ok(!sameFile(identity, { ...identity, projectId: "p2" }));
});

test("errors retry on the back-off schedule and then wait for the person", () => {
  let entry = startedEntry("f1", identity);
  for (const [index, delay] of retryDelaysMs.entries()) {
    entry = withError(entry, 1_000);
    assert.equal(entry.status, "retrying");
    assert.equal(entry.attempt, index + 1);
    assert.equal(entry.retryAt, 1_000 + delay);
  }
  entry = withError(entry, 1_000);
  assert.equal(entry.status, "failed");
  assert.equal(entry.retryAt, null);
  assert.equal(withManualRetry(entry).attempt, 0);
  assert.equal(withManualRetry(entry).status, "uploading");
});

test("progress resets the attempts, and a paused file stays paused", () => {
  let entry = withError(startedEntry("f1", identity), 0);
  entry = withProgress(entry, 100);
  assert.equal(entry.status, "uploading");
  assert.equal(entry.attempt, 0);
  assert.equal(withProgress(withPause(entry, true), 200).status, "paused");
  assert.equal(withPause(withPause(entry, true), false).status, "uploading");
});

test("a finished file stays finished and counts every byte", () => {
  const done = withDone(startedEntry("f1", identity), identity.size);
  assert.equal(done.bytesUploaded, identity.size);
  assert.equal(withProgress(done, 5), done);
  assert.equal(withPause(done, true), done);
});

test("only unfinished files are kept as hints for a reload", () => {
  const unfinished = startedEntry("f1", identity);
  const finished = withDone(startedEntry("f2", { ...identity, name: "other.bin" }), 1);
  const hints = decodeHints(encodeHints([unfinished, finished]));
  assert.deepEqual(hints, [identity]);
  assert.equal(interruptedEntry(hints[0] as FileIdentity).status, "interrupted");
});

test("broken hints are ignored", () => {
  assert.deepEqual(decodeHints(null), []);
  assert.deepEqual(decodeHints("{"), []);
  assert.deepEqual(decodeHints('[{"name":1}]'), []);
});
