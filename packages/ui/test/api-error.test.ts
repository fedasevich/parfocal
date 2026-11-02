import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError, type ErrorKind, networkError, toApiError } from "@parfocal/api-client";
import {
  describeApiError,
  errorKinds,
  fieldErrorsByName,
  fieldName,
} from "../src/lib/api-error.ts";

const leak = 'Traceback (most recent call last): File "/srv/parfocal_api/app.py"';

function problemResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/problem+json" },
  });
}

const statuses: Record<Exclude<ErrorKind, "network">, number> = {
  "bad-request": 400,
  unauthenticated: 401,
  forbidden: 403,
  "not-found": 404,
  conflict: 409,
  validation: 422,
  server: 500,
};

test("every error kind has its own title and plain copy", () => {
  assert.deepEqual(new Set(errorKinds), new Set([...Object.keys(statuses), "network"]));
  const titles = errorKinds.map((kind) => describeApiError(new ApiError(kind, 0)).title);
  assert.equal(new Set(titles).size, errorKinds.length);
  for (const kind of errorKinds) {
    const notice = describeApiError(new ApiError(kind, 0));
    assert.equal(notice.kind, kind);
    assert.ok(notice.message.endsWith("."));
  }
});

for (const [kind, status] of Object.entries(statuses)) {
  test(`a ${status} response reads as ${kind} and never shows the server's title or stack`, async () => {
    const error = await toApiError(
      problemResponse(status, {
        type: `https://parfocal.eu/problems/${kind}`,
        title: "Raw server title",
        status,
        code: kind,
      }),
    );
    error.stack = leak;
    const notice = describeApiError(error);
    assert.equal(notice.kind, kind);
    const shown = `${notice.title} ${notice.message}`;
    assert.ok(!shown.includes("Raw server title"));
    assert.ok(!shown.includes("Traceback"));
  });
}

test("a network failure asks to check the connection and offers a retry", () => {
  const notice = describeApiError(networkError());
  assert.equal(notice.kind, "network");
  assert.equal(notice.action, "retry");
  assert.match(notice.message, /connection/);
});

test("a safe detail on a client error replaces the default message", async () => {
  const error = await toApiError(
    problemResponse(409, {
      type: "https://parfocal.eu/problems/conflict",
      title: "Conflict",
      status: 409,
      code: "conflict",
      detail: "Daniel signed this slide off a minute ago.",
    }),
  );
  assert.equal(describeApiError(error).message, "Daniel signed this slide off a minute ago.");
});

for (const kind of ["server", "unauthenticated", "validation", "network"] as const) {
  test(`a ${kind} error never shows the server's detail`, () => {
    const error = new ApiError(kind, 500, {
      type: "https://parfocal.eu/problems/internal",
      title: "Internal error",
      status: 500,
      code: "internal",
      detail: leak,
    });
    assert.ok(!describeApiError(error).message.includes("Traceback"));
  });
}

test("each kind names the action the toast offers", () => {
  const actions = Object.fromEntries(
    errorKinds.map((kind) => [kind, describeApiError(new ApiError(kind, 0)).action]),
  );
  assert.deepEqual(actions, {
    "bad-request": undefined,
    unauthenticated: "sign-in",
    forbidden: undefined,
    "not-found": undefined,
    conflict: "reload",
    validation: undefined,
    server: "retry",
    network: "retry",
  });
});

test("validation errors map onto field names without the request part", async () => {
  const error = await toApiError(
    problemResponse(422, {
      type: "https://parfocal.eu/problems/validation",
      title: "Some fields are not valid",
      status: 422,
      code: "validation",
      errors: [
        { location: ["body", "name"], message: "Give the task a name.", code: "missing" },
        { location: ["body", "name"], message: "A second message.", code: "too_short" },
        { location: ["body", "reviewers", 0, "email"], message: "Not an email.", code: "email" },
        { location: ["query", "limit"], message: "Too large.", code: "le" },
      ],
    }),
  );
  assert.equal(error.kind, "validation");
  assert.deepEqual(fieldErrorsByName(error), {
    name: "Give the task a name.",
    "reviewers.0.email": "Not an email.",
    limit: "Too large.",
  });
});

test("a field location without a request part keeps every part", () => {
  assert.equal(fieldName(["settings", "scale"]), "settings.scale");
  assert.deepEqual(fieldErrorsByName(networkError()), {});
});
