import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createRangeCache } from "../../src/index.ts";

const blockSize = 16;
const url = "https://slides.example/slide.tiff";

function fileOf(size: number): Uint8Array {
  return Uint8Array.from({ length: size }, (_, index) => index % 251);
}

interface Seen {
  readonly range: string | null;
  readonly signal: AbortSignal | null;
}

function fakeServer(file: Uint8Array, options: { gate?: Promise<void> } = {}) {
  const seen: Seen[] = [];
  const fetch = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const range = new Headers(init?.headers).get("range");
    seen.push({ range, signal: init?.signal ?? null });
    await options.gate;
    if (range === null) return new Response(file.slice(), { status: 200 });
    const match = /^bytes=(\d+)-(\d+)$/.exec(range);
    if (match === null) return new Response(null, { status: 400 });
    const start = Number(match[1]);
    if (start >= file.length) {
      return new Response(null, {
        status: 416,
        headers: { "content-range": `bytes */${file.length}` },
      });
    }
    const end = Math.min(Number(match[2]), file.length - 1);
    return new Response(file.slice(start, end + 1), {
      status: 206,
      headers: { "content-range": `bytes ${start}-${end}/${file.length}` },
    });
  };
  return { fetch, seen };
}

describe("the shared range cache", () => {
  it("fetches contiguous missing blocks in one request and serves repeats from memory", async () => {
    const file = fileOf(100);
    const server = fakeServer(file);
    const cache = createRangeCache({ blockSize, fetch: server.fetch });
    const first = await cache.get(url, "bytes=5-40");
    assert.equal(first.status, 206);
    assert.deepEqual(first.bytes, file.slice(5, 41));
    assert.equal(first.contentRange, "bytes 5-40/100");
    assert.deepEqual(
      server.seen.map(({ range }) => range),
      ["bytes=0-47"],
    );
    const again = await cache.get(url, "bytes=17-30");
    assert.deepEqual(again.bytes, file.slice(17, 31));
    assert.equal(server.seen.length, 1);
    await cache.get(url, "bytes=30-70");
    assert.deepEqual(
      server.seen.map(({ range }) => range),
      ["bytes=0-47", "bytes=48-79"],
    );
    assert.deepEqual(cache.stats(), {
      fetches: 2,
      bytes: 80,
      blockHits: 3,
      blockJoins: 0,
      cachedBlocks: 5,
    });
  });

  it("shares one download between workers asking for the same block at once", async () => {
    let open = () => {};
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const file = fileOf(64);
    const server = fakeServer(file, { gate });
    const cache = createRangeCache({ blockSize, fetch: server.fetch });
    const replies = Promise.all([
      cache.get(url, "bytes=0-9"),
      cache.get(url, "bytes=4-15"),
      cache.get(url, "bytes=8-12"),
    ]);
    open();
    const [a, b, c] = await replies;
    assert.equal(server.seen.length, 1);
    assert.deepEqual(a.bytes, file.slice(0, 10));
    assert.deepEqual(b.bytes, file.slice(4, 16));
    assert.deepEqual(c.bytes, file.slice(8, 13));
    assert.equal(cache.stats().blockJoins, 2);
  });

  it("never hands the network an abort signal, so a finished download always lands in the cache", async () => {
    const file = fileOf(64);
    const server = fakeServer(file);
    const cache = createRangeCache({ blockSize, fetch: server.fetch });
    await cache.get(url, "bytes=0-31");
    assert.deepEqual(
      server.seen.map(({ signal }) => signal),
      [null],
    );
    await cache.get(url, "bytes=0-31");
    assert.equal(server.seen.length, 1);
  });

  it("clips a range at the end of the file and answers 416 past it", async () => {
    const file = fileOf(40);
    const server = fakeServer(file);
    const cache = createRangeCache({ blockSize, fetch: server.fetch });
    const tail = await cache.get(url, "bytes=30-63");
    assert.equal(tail.status, 206);
    assert.deepEqual(tail.bytes, file.slice(30));
    assert.equal(tail.contentRange, "bytes 30-39/40");
    const past = await cache.get(url, "bytes=50-60");
    assert.equal(past.status, 416);
    assert.equal(past.contentRange, "bytes */40");
    assert.equal(server.seen.length, 1);
  });

  it("evicts the least recently used block beyond its limit", async () => {
    const file = fileOf(64);
    const server = fakeServer(file);
    const cache = createRangeCache({ blockSize, maxBlocks: 2, fetch: server.fetch });
    await cache.get(url, "bytes=0-0");
    await cache.get(url, "bytes=16-16");
    await cache.get(url, "bytes=0-0");
    await cache.get(url, "bytes=32-32");
    await cache.get(url, "bytes=0-0");
    await cache.get(url, "bytes=16-16");
    assert.deepEqual(
      server.seen.map(({ range }) => range),
      ["bytes=0-15", "bytes=16-31", "bytes=32-47", "bytes=16-31"],
    );
  });

  it("passes a whole-object request through with its status, sharing it while in flight", async () => {
    const file = fileOf(20);
    const server = fakeServer(file);
    const cache = createRangeCache({ blockSize, fetch: server.fetch });
    const [a, b] = await Promise.all([cache.get(url, null), cache.get(url, null)]);
    assert.equal(a.status, 200);
    assert.deepEqual(a.bytes, file);
    assert.deepEqual(b.bytes, file);
    assert.notEqual(a.bytes.buffer, b.bytes.buffer);
    assert.equal(server.seen.length, 1);
  });
});
