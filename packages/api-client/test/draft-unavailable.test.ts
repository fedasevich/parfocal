import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { z } from "zod";
import { defineDraftQuery } from "../src/draft/define.ts";
import { defineDraftMutation } from "../src/draft/define-mutation.ts";
import {
  DraftNotAvailableError,
  isDraftNotAvailable,
  notAvailableCode,
  setDraftsAnswered,
} from "../src/draft/support.ts";
import { ApiError } from "../src/index.ts";

const original = globalThis.fetch;
let status = 404;

const answer = (code: number) =>
  new Response(
    JSON.stringify({ type: "about:blank", title: "Missing", status: code, code: "not-found" }),
    { status: code, headers: { "content-type": "application/problem+json" } },
  );

beforeEach(() => {
  status = 404;
  setDraftsAnswered(false);
  globalThis.fetch = () => Promise.resolve(answer(status));
});

afterEach(() => {
  globalThis.fetch = original;
  setDraftsAnswered(true);
});

const list = defineDraftQuery(
  "listThings",
  () => "http://app.test/api/things",
  z.array(z.string()),
);
const maybe = defineDraftQuery(
  "getMaybe",
  () => "http://app.test/api/maybe",
  z.object({ id: z.string() }).nullable(),
);
const thing = defineDraftQuery(
  "getThing",
  () => "http://app.test/api/thing",
  z.object({ id: z.string() }),
);
const save = defineDraftMutation(
  "saveThing",
  { method: "POST", url: () => "http://app.test/api/thing" },
  z.object({ id: z.string() }),
);

test("a missing list route answers an empty list", async () => {
  const response = await list.fetcher([]);
  assert.deepEqual(response.data, []);
});

test("a missing nullable route answers null", async () => {
  status = 405;
  const response = await maybe.fetcher([]);
  assert.equal(response.data, null);
});

test("a missing object route throws the not available error", async () => {
  await assert.rejects(thing.fetcher([]), (error: unknown) => {
    assert.ok(isDraftNotAvailable(error));
    assert.equal(error.operationId, "getThing");
    assert.equal(error.kind, "not-found");
    assert.equal(error.problem?.code, notAvailableCode);
    return true;
  });
});

test("a missing mutation route throws the not available error", async () => {
  await assert.rejects(save.fetcher(undefined), DraftNotAvailableError);
});

test("other failures pass through unchanged", async () => {
  status = 403;
  await assert.rejects(thing.fetcher([]), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.ok(!isDraftNotAvailable(error));
    return true;
  });
});

test("with the fake answering drafts a 404 stays a plain error", async () => {
  setDraftsAnswered(true);
  await assert.rejects(list.fetcher([]), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.ok(!isDraftNotAvailable(error));
    assert.equal(error.status, 404);
    return true;
  });
});
