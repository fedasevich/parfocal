import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError } from "@parfocal/api-client";
import {
  createQueryClient,
  retryDelay,
  shouldRetry,
  toastsMutationError,
} from "../src/query-client.ts";

test("only network and server failures retry, at most three times", () => {
  assert.equal(shouldRetry(0, new ApiError("network", 0)), true);
  assert.equal(shouldRetry(2, new ApiError("server", 503)), true);
  assert.equal(shouldRetry(3, new ApiError("server", 503)), false);
  assert.equal(shouldRetry(0, new ApiError("not-found", 404)), false);
  assert.equal(shouldRetry(0, new ApiError("unauthenticated", 401)), false);
  assert.equal(shouldRetry(0, new Error("boom")), false);
});

test("retry delays start at 250 ms and double up to 4 s", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(retryDelay), [250, 500, 1000, 2000, 4000, 4000]);
});

test("the query client carries ADR 0049's defaults", () => {
  const queries = createQueryClient().getDefaultOptions().queries;
  assert.equal(queries?.staleTime, 30_000);
  assert.equal(queries?.gcTime, 300_000);
  assert.equal(queries?.refetchOnWindowFocus, true);
});

test("a failed mutation toasts unless its caller handles it or it is a field error", () => {
  const forbidden = new ApiError("forbidden", 403);
  assert.equal(toastsMutationError(forbidden, false), true);
  assert.equal(toastsMutationError(forbidden, true), false);
  assert.equal(toastsMutationError(new ApiError("validation", 422), false), false);
  assert.equal(toastsMutationError(new Error("boom"), false), false);
});

test("the query client hands an unhandled mutation failure to the toast", async () => {
  const seen: string[] = [];
  const client = createQueryClient((error) => seen.push(error.kind));
  const failing = () => Promise.reject(new ApiError("forbidden", 403));
  await client
    .getMutationCache()
    .build(client, { mutationFn: failing })
    .execute(undefined)
    .catch(() => {});
  await client
    .getMutationCache()
    .build(client, { mutationFn: failing, onError: () => {} })
    .execute(undefined)
    .catch(() => {});
  assert.deepEqual(seen, ["forbidden"]);
});
