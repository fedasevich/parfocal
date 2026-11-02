import assert from "node:assert/strict";
import { test } from "node:test";
import {
  countThreads,
  emptyThreadsLine,
  filterOfThread,
  filterThreads,
} from "../src/lib/comment-threads.ts";

const threads = [
  { id: "a", resolved: false },
  { id: "b", resolved: true },
  { id: "c", resolved: false },
];

test("open and resolved threads are told apart and counted", () => {
  assert.deepEqual(
    filterThreads(threads, "open").map((thread) => thread.id),
    ["a", "c"],
  );
  assert.deepEqual(
    filterThreads(threads, "resolved").map((thread) => thread.id),
    ["b"],
  );
  assert.deepEqual(countThreads(threads), { open: 2, resolved: 1 });
  assert.deepEqual(countThreads([]), { open: 0, resolved: 0 });
});

test("a thread names the filter it sits under", () => {
  assert.equal(filterOfThread(threads, "b"), "resolved");
  assert.equal(filterOfThread(threads, "a"), "open");
  assert.equal(filterOfThread(threads, "missing"), undefined);
  assert.equal(filterOfThread(threads, undefined), undefined);
});

test("an empty list says what is missing and where the others are", () => {
  assert.match(emptyThreadsLine("open", 2), /Resolved/);
  assert.match(emptyThreadsLine("open", 0), /No comments on this slide/);
  assert.match(emptyThreadsLine("resolved", 0), /No resolved/);
});
