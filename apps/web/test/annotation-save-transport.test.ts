import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import type { AnnotationDraft } from "@parfocal/api-client";
import { annotationTransport, sharedLayerTransport } from "../src/annotations/save-transport.ts";

type Call = { url: string; method: string; body: unknown };

const real = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = real;
});

const polygon = (corner: number) => ({
  type: "Polygon" as const,
  coordinates: [
    [
      [0, 0],
      [corner, 0],
      [corner, corner],
      [0, 0],
    ],
  ],
});

const draft: AnnotationDraft = {
  kind: "region",
  geometry: {
    type: "Polygon",
    coordinates: [
      [
        [0, 0],
        [5, 0],
        [5, 5],
        [0, 0],
      ],
    ],
  },
};

const colleagueObject = {
  id: "o-1",
  version: 4,
  geometry: polygon(9),
  class_id: null,
  deleted_at: null,
  changed_by_user_id: "u-2",
};

function problem(status: number, code: string, current?: unknown): Response {
  return new Response(JSON.stringify({ type: `urn:${code}`, title: code, status, code, current }), {
    status,
    headers: { "content-type": "application/problem+json" },
  });
}

function answer(...responses: Response[]): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (input, init) => {
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : null;
    calls.push({
      url: input instanceof Request ? input.url : String(input),
      method: init?.method ?? "GET",
      body,
    });
    const next = responses.shift();
    return Promise.resolve(next ?? new Response("{}", { status: 500 }));
  };
  return calls;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("shared layer saves", () => {
  test("an edit goes to the shared layer with the held version", async () => {
    const calls = answer(json(200, { ...colleagueObject, version: 3 }));
    const outcome = await sharedLayerTransport("t-1", "s-1").update("o-1", 2, draft);
    assert.deepEqual(outcome, { kind: "done", value: { version: 3 } });
    assert.equal(calls[0]?.method, "PATCH");
    assert.ok(calls[0]?.url.endsWith("/api/review-tasks/t-1/slides/s-1/shared-layer/objects/o-1"));
    assert.deepEqual(calls[0]?.body, { version: 2, geometry: draft.geometry });
  });

  test("a stale edit answers with the colleague's version from the conflict", async () => {
    answer(problem(409, "annotation-changed", colleagueObject));
    const outcome = await sharedLayerTransport("t-1", "s-1").update("o-1", 2, draft);
    assert.equal(outcome.kind, "conflict");
    if (outcome.kind !== "conflict") return;
    assert.equal(outcome.theirs.version, 4);
    assert.equal(outcome.theirs.deleted, false);
    assert.equal(outcome.theirs.changedBy, "u-2");
  });

  test("a stale delete meets the colleague's version too, a deleted one included", async () => {
    answer(
      problem(409, "annotation-changed", {
        ...colleagueObject,
        deleted_at: "2026-11-05T10:00:00Z",
      }),
    );
    const outcome = await sharedLayerTransport("t-1", "s-1").remove("o-1", 2);
    assert.equal(outcome.kind === "conflict" && outcome.theirs.deleted, true);
  });

  test("a conflict without the current object is refused instead of retried", async () => {
    answer(problem(409, "annotation-changed"));
    const outcome = await sharedLayerTransport("t-1", "s-1").update("o-1", 2, draft);
    assert.equal(outcome.kind, "rejected");
  });

  test("server trouble is retried and a client mistake is not", async () => {
    answer(problem(503, "unavailable"), problem(422, "invalid-shape"));
    const transport = sharedLayerTransport("t-1", "s-1");
    assert.equal((await transport.update("o-1", 2, draft)).kind, "retry");
    assert.equal((await transport.update("o-1", 2, draft)).kind, "rejected");
  });
});

describe("personal layer saves", () => {
  test("a stale edit fetches the shape to show the colleague's version", async () => {
    const calls = answer(problem(409, "annotation-changed"), json(200, colleagueObject));
    const outcome = await annotationTransport("s-1").update("o-1", 2, draft);
    assert.equal(outcome.kind === "conflict" && outcome.theirs.version, 4);
    assert.equal(calls[1]?.method, "GET");
    assert.ok(calls[1]?.url.endsWith("/api/slides/s-1/annotations/o-1"));
  });

  test("a stale edit of a shape that is gone is a conflict with a deleted version", async () => {
    answer(problem(409, "annotation-changed"), problem(404, "not-found"));
    const outcome = await annotationTransport("s-1").update("o-1", 2, draft);
    assert.equal(outcome.kind === "conflict" && outcome.theirs.deleted, true);
  });

  test("deleting a shape that is already gone is done", async () => {
    answer(problem(404, "not-found"));
    const outcome = await annotationTransport("s-1").remove("o-1", 2);
    assert.equal(outcome.kind, "done");
  });

  test("a cut network is retried", async () => {
    globalThis.fetch = () => Promise.reject(new TypeError("Failed to fetch"));
    const outcome = await annotationTransport("s-1").update("o-1", 2, draft);
    assert.equal(outcome.kind, "retry");
  });
});
