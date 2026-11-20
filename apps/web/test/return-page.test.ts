import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isViewerPage,
  nextReturnPage,
  readReturnPage,
  returnPageOf,
  writeReturnPage,
} from "../src/viewer/return-page.ts";

test("the pages a slide opens from are named by kind", () => {
  assert.deepEqual(returnPageOf("/my-work", "/my-work?tab=done"), {
    href: "/my-work?tab=done",
    kind: "my-work",
  });
  assert.equal(returnPageOf("/projects/p1", "/projects/p1")?.kind, "project");
  assert.equal(returnPageOf("/tasks/t1/disagreements", "/x")?.kind, "disagreements");
  assert.equal(returnPageOf("/tasks/t1/adjudicate", "/x")?.kind, "adjudication");
  assert.equal(returnPageOf("/settings/general", "/settings/general"), null);
  assert.equal(returnPageOf("/search", "/search?q=S26-04812")?.href, "/search");
});

test("viewer pages keep the page the person came from", () => {
  assert.equal(isViewerPage("/projects/p1/slides/s1"), true);
  assert.equal(isViewerPage("/tasks/t1/guided"), true);
  assert.equal(isViewerPage("/tasks/t1/submitted"), true);
  assert.equal(isViewerPage("/projects/p1"), false);
  const project = { href: "/projects/p1", kind: "project" } as const;
  assert.deepEqual(
    nextReturnPage(project, "/projects/p1/slides/s2", "/projects/p1/slides/s2"),
    project,
  );
  assert.equal(nextReturnPage(project, "/my-work", "/my-work")?.kind, "my-work");
  assert.equal(nextReturnPage(project, "/team", "/team"), null);
});

test("the return page survives the session store and ignores what it does not know", () => {
  const values = new Map<string, string>();
  const store = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
  assert.equal(readReturnPage(store), null);
  writeReturnPage(store, { href: "/tasks/t1/disagreements?row=2", kind: "disagreements" });
  assert.deepEqual(readReturnPage(store), {
    href: "/tasks/t1/disagreements?row=2",
    kind: "disagreements",
  });
  values.set(
    "parfocal.viewer-return",
    JSON.stringify({ href: "https://evil.example/x", kind: "home" }),
  );
  assert.equal(readReturnPage(store)?.href, undefined);
  values.set("parfocal.viewer-return", "not json");
  assert.equal(readReturnPage(store), null);
  writeReturnPage(store, null);
  assert.equal(readReturnPage(store), null);
});
