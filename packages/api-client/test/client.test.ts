import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { ApiError, getGetHealthQueryKey, getHealth, getRestrictedImage } from "../src/index.ts";

const realFetch = globalThis.fetch;
const requests: { url: string; init: RequestInit | undefined }[] = [];

function stubFetch(respond: () => Response | Promise<Response>) {
  globalThis.fetch = (input, init) => {
    const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
    requests.push({ url, init });
    return Promise.resolve(respond());
  };
}

afterEach(() => {
  globalThis.fetch = realFetch;
  requests.length = 0;
});

test("the generated client returns typed data from the API", async () => {
  stubFetch(() => Response.json({ status: "ok" }));
  const response = await getHealth();
  assert.equal(response.status, 200);
  assert.deepEqual(response.data, { status: "ok" });
  assert.equal(requests[0]?.url, "/api/health");
  assert.equal(requests[0]?.init?.method, "GET");
  assert.equal(requests[0]?.init?.credentials, "same-origin");
  assert.deepEqual(getGetHealthQueryKey(), ["/api/health"]);
});

test("problem responses reject with a typed ApiError", async () => {
  stubFetch(
    () =>
      new Response(
        JSON.stringify({
          type: "https://parfocal.eu/problems/unauthenticated",
          title: "Sign in to continue",
          status: 401,
          code: "unauthenticated",
        }),
        { status: 401, headers: { "content-type": "application/problem+json" } },
      ),
  );
  await assert.rejects(getHealth(), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.kind, "unauthenticated");
    return true;
  });
});

test("a failed connection rejects with a network error", async () => {
  stubFetch(() => Promise.reject(new TypeError("fetch failed")));
  await assert.rejects(
    getHealth(),
    (error: unknown) => error instanceof ApiError && error.kind === "network",
  );
});

test("an image response comes back as a Blob and is not parsed as JSON", async () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
  stubFetch(() => new Response(png, { headers: { "content-type": "image/png" } }));
  const response = await getRestrictedImage("slide-1", "label");
  assert.equal(response.status, 200);
  assert.ok(response.data instanceof Blob);
  assert.deepEqual(new Uint8Array(await response.data.arrayBuffer()), png);
  assert.equal(requests[0]?.url, "/api/slides/slide-1/restricted-images/label");
});
