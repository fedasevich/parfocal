import assert from "node:assert/strict";
import { test } from "node:test";
import { joinToken, type LinkRow, remoteProgress } from "../src/study/study-links.ts";
import type { StudySession, TaskRecord } from "../src/study/study-model.ts";
import type { ServerSession } from "../src/study/study-results.ts";

const link = (code: string, state: LinkRow["state"]): LinkRow => ({
  code,
  state,
  expires_at: "2026-11-26T10:00:00Z",
});

const served = (participant: string, session: Partial<StudySession>, updatedAt: string) =>
  ({
    key: `${participant}-${updatedAt}`,
    participant,
    round: 1,
    dryRun: false,
    traceParts: 0,
    updatedAt,
    session: {
      id: "s",
      round: 1,
      participant,
      startedAt: 0,
      results: [],
      blocks: [],
      ...session,
    },
  }) satisfies ServerSession;

const tasks = (count: number) => Array.from({ length: count }, () => ({}) as TaskRecord);

test("a link reads as waiting, expired or joined until the session uploads", () => {
  assert.deepEqual(
    remoteProgress([link("P-A", "waiting"), link("P-B", "expired"), link("P-C", "joined")], [], 11),
    [
      { code: "P-A", kind: "waiting", expiresAt: "2026-11-26T10:00:00Z" },
      { code: "P-B", kind: "expired" },
      { code: "P-C", kind: "joined" },
    ],
  );
});

test("the latest uploaded session gives the tasks done and the finish", () => {
  const sessions = [
    served("P-A", { tasks: tasks(1) }, "2026-11-25T10:00:00Z"),
    served("P-A", { tasks: tasks(3) }, "2026-11-25T10:05:00Z"),
    served("P-B", { tasks: tasks(11), final: { finishedAt: 5 } as StudySession["final"] }, "x"),
  ];
  assert.deepEqual(
    remoteProgress(
      [link("P-A", "joined"), link("P-A", "expired"), link("P-B", "joined")],
      sessions,
      11,
    ),
    [
      { code: "P-A", kind: "working", done: 3, total: 11, updatedAt: "2026-11-25T10:05:00Z" },
      { code: "P-B", kind: "finished", total: 11, updatedAt: "x" },
    ],
  );
});

test("only a plain token in the fragment counts as a join token", () => {
  assert.equal(
    joinToken("#abcdefghijklmnopqrstuvwxyz_-0123456789"),
    "abcdefghijklmnopqrstuvwxyz_-0123456789",
  );
  assert.equal(joinToken(""), undefined);
  assert.equal(joinToken("#short"), undefined);
  assert.equal(joinToken("#has space in the token value!!"), undefined);
});
