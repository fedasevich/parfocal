import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError, isProblem, kindForStatus, networkError, toApiError } from "../src/problem.ts";

function problemResponse(status: number, body: unknown, contentType = "application/problem+json") {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": contentType } });
}

test("every documented status maps to a kind", () => {
  assert.deepEqual([400, 401, 403, 404, 409, 422, 500, 503, 418].map(kindForStatus), [
    "bad-request",
    "unauthenticated",
    "forbidden",
    "not-found",
    "conflict",
    "validation",
    "server",
    "server",
    "bad-request",
  ]);
});

test("a problem response becomes a typed error", async () => {
  const error = await toApiError(
    problemResponse(404, {
      type: "https://parfocal.eu/problems/not-found",
      title: "Not found",
      status: 404,
      code: "not-found",
      detail: "Case S26-0001 does not exist",
    }),
  );
  assert.ok(error instanceof ApiError);
  assert.equal(error.kind, "not-found");
  assert.equal(error.message, "Not found");
  assert.equal(error.problem?.detail, "Case S26-0001 does not exist");
});

test("validation errors expose their fields", async () => {
  const error = await toApiError(
    problemResponse(422, {
      type: "https://parfocal.eu/problems/validation",
      title: "Some fields are not valid",
      status: 422,
      code: "validation",
      errors: [
        {
          location: ["body", "priority"],
          message: "Input should be a valid integer",
          code: "int_parsing",
        },
      ],
    }),
  );
  assert.equal(error.kind, "validation");
  assert.deepEqual(error.fieldErrors()[0]?.location, ["body", "priority"]);
});

test("responses that are not problems still map by status", async () => {
  const html = await toApiError(new Response("<h1>Bad gateway</h1>", { status: 502 }));
  assert.equal(html.kind, "server");
  assert.equal(html.problem, undefined);
  const wrongShape = await toApiError(problemResponse(409, { message: "nope" }));
  assert.equal(wrongShape.kind, "conflict");
  assert.equal(wrongShape.problem, undefined);
  const brokenJson = await toApiError(
    new Response("{", { status: 401, headers: { "content-type": "application/problem+json" } }),
  );
  assert.equal(brokenJson.kind, "unauthenticated");
});

test("network failures have their own kind", () => {
  assert.equal(networkError().kind, "network");
  assert.equal(isProblem({ type: "x", title: "y", status: 400, code: "z", errors: [{}] }), false);
});
