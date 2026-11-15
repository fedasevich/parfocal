import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { retryingFetch } from "./retrying-fetch.ts";

function flaky(failures: number): { fetch: typeof globalThis.fetch; calls: () => number } {
  let calls = 0;
  return {
    calls: () => calls,
    fetch: () => {
      calls++;
      if (calls <= failures) return Promise.reject(new TypeError("fetch failed: ECONNRESET"));
      return Promise.resolve(new Response("ok", { status: 206 }));
    },
  };
}

describe("retrying fetch for real-slide tests", () => {
  it("recovers from a dropped read and returns the response", async () => {
    const source = flaky(2);
    const read = retryingFetch("CMU-1.ndpi", { fetch: source.fetch, backoffMs: 1 });
    const response = await read("http://x/slide", { headers: { range: "bytes=0-9" } });
    assert.equal(response.status, 206);
    assert.equal(source.calls(), 3);
  });

  it("retries a transient status", async () => {
    let calls = 0;
    const read = retryingFetch("CMU-1.ndpi", {
      backoffMs: 1,
      fetch: () => Promise.resolve(new Response("", { status: ++calls < 2 ? 503 : 206 })),
    });
    assert.equal((await read("http://x/slide")).status, 206);
    assert.equal(calls, 2);
  });

  it("names the slide and range when every attempt fails", async () => {
    const source = flaky(99);
    const read = retryingFetch("CMU-1.ndpi", { fetch: source.fetch, backoffMs: 1, attempts: 3 });
    await assert.rejects(
      read("http://x/slide", { headers: { range: "bytes=100-199" } }),
      /CMU-1\.ndpi.*bytes=100-199.*3 attempts.*ECONNRESET/,
    );
    assert.equal(source.calls(), 3);
  });

  it("does not retry a missing file", async () => {
    let calls = 0;
    const read = retryingFetch("CMU-1.ndpi", {
      backoffMs: 1,
      fetch: () => {
        calls++;
        return Promise.resolve(new Response("", { status: 404 }));
      },
    });
    assert.equal((await read("http://x/slide")).status, 404);
    assert.equal(calls, 1);
  });
});
