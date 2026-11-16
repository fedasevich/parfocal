import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { signCapability, signingKey } from "../src/capability.ts";
import worker, { type EdgeEnv } from "../src/index.ts";

const SECRET = btoa("k".repeat(32));
const TENANT = "11111111-1111-4111-8111-111111111111";
const SLIDE = "33333333-3333-4333-8333-333333333333";
const SIZE = 4096;
const BYTES = Uint8Array.from({ length: SIZE }, (_, index) => index % 251);

type Stored = { bytes: Uint8Array; etag: string };

function bucket(reads: string[], stored: Stored = { bytes: BYTES, etag: "v1" }): R2Bucket {
  return {
    get: (key: string, options: { range?: { offset: number; length: number } }) => {
      reads.push(key);
      const { offset = 0, length = SIZE } = options.range ?? {};
      return Promise.resolve({
        key,
        size: stored.bytes.length,
        etag: stored.etag,
        httpEtag: `"${stored.etag}"`,
        httpMetadata: {},
        body: new Blob([stored.bytes.slice(offset, offset + length)]).stream(),
      });
    },
    head: () => Promise.resolve(null),
  } as unknown as R2Bucket;
}

class MemoryCache {
  readonly entries = new Map<string, { bytes: Uint8Array; headers: Headers }>();

  match(request: Request) {
    const entry = this.entries.get(request.url);
    return Promise.resolve(
      entry === undefined
        ? undefined
        : new Response(entry.bytes.slice(), { headers: entry.headers }),
    );
  }

  async put(request: Request, response: Response) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    this.entries.set(request.url, { bytes, headers: new Headers(response.headers) });
  }
}

function context(pending: Promise<unknown>[]): ExecutionContext {
  return {
    waitUntil: (work: Promise<unknown>) => {
      pending.push(work);
    },
    passThroughOnException: () => undefined,
    props: {},
  } as unknown as ExecutionContext;
}

async function tileRequest(etag?: string): Promise<Request> {
  const token = await signCapability(
    {
      tenant: TENANT,
      slide: SLIDE,
      original: "original.svs",
      size: SIZE,
      ...(etag === undefined ? {} : { etag }),
      restricted: [],
      expires: Math.floor(Date.now() / 1000) + 600,
    },
    await signingKey(SECRET),
  );
  return new Request(`https://parfocal.test/tiles/${SLIDE}/original.svs`, {
    headers: { Authorization: `Bearer ${token}`, Range: "bytes=1000-1999" },
  });
}

const holder = globalThis as { caches?: unknown };

afterEach(() => {
  delete holder.caches;
});

test("the Worker serves a repeated tile range from the edge cache", async () => {
  const cache = new MemoryCache();
  holder.caches = { default: cache };
  const reads: string[] = [];
  const pending: Promise<unknown>[] = [];
  const env = {
    SLIDES: bucket(reads),
    TILE_TOKEN_KEY: SECRET,
    ROOMS: {} as DurableObjectNamespace,
    ROOM_TOKEN_KEY: SECRET,
    LOCAL_RUN: "true",
  } satisfies EdgeEnv;
  const first = await worker.fetch(await tileRequest(), env, context(pending));
  const firstBytes = new Uint8Array(await first.arrayBuffer());
  await Promise.all(pending);
  const second = await worker.fetch(await tileRequest(), env, context(pending));
  assert.equal(first.status, 206);
  assert.equal(second.status, 206);
  assert.match(first.headers.get("Server-Timing") ?? "", /cache;desc=miss/);
  assert.match(second.headers.get("Server-Timing") ?? "", /cache;desc=hit/);
  assert.equal(second.headers.get("Content-Range"), `bytes 1000-1999/${SIZE}`);
  assert.deepEqual(new Uint8Array(await second.arrayBuffer()), firstBytes);
  assert.deepEqual(firstBytes, BYTES.slice(1000, 2000));
  assert.equal(reads.length, 1);
  assert.equal(cache.entries.size, 1);
});

test("the Worker reads the bucket when no edge cache exists", async () => {
  const reads: string[] = [];
  const env = {
    SLIDES: bucket(reads),
    TILE_TOKEN_KEY: SECRET,
    ROOMS: {} as DurableObjectNamespace,
    ROOM_TOKEN_KEY: SECRET,
    LOCAL_RUN: "true",
  } satisfies EdgeEnv;
  for (let round = 0; round < 2; round += 1) {
    const response = await worker.fetch(await tileRequest(), env, context([]));
    assert.equal(response.status, 206);
    await response.arrayBuffer();
  }
  assert.equal(reads.length, 2);
});

function edgeEnv(slides: R2Bucket): EdgeEnv {
  return {
    SLIDES: slides,
    TILE_TOKEN_KEY: SECRET,
    ROOMS: {} as DurableObjectNamespace,
    ROOM_TOKEN_KEY: SECRET,
    LOCAL_RUN: "true",
  };
}

const REWRITTEN = Uint8Array.from({ length: SIZE }, (_, index) => (index * 7) % 251);

test("an original rewritten at the same size misses the edge cache", async () => {
  const cache = new MemoryCache();
  holder.caches = { default: cache };
  const reads: string[] = [];
  const pending: Promise<unknown>[] = [];
  const stored = { bytes: BYTES, etag: "aaaa-2" };
  const env = edgeEnv(bucket(reads, stored));
  const first = await worker.fetch(await tileRequest("aaaa-2"), env, context(pending));
  await first.arrayBuffer();
  await Promise.all(pending);
  stored.bytes = REWRITTEN;
  stored.etag = "bbbb-2";
  const second = await worker.fetch(await tileRequest("bbbb-2"), env, context(pending));
  const secondBytes = new Uint8Array(await second.arrayBuffer());
  await Promise.all(pending);
  assert.equal(second.status, 206);
  assert.match(second.headers.get("Server-Timing") ?? "", /cache;desc=miss/);
  assert.deepEqual(secondBytes, REWRITTEN.slice(1000, 2000));
  assert.equal(reads.length, 2);
  assert.equal(cache.entries.size, 2);
});

test("a token signed before a rewrite is served but never cached", async () => {
  const cache = new MemoryCache();
  holder.caches = { default: cache };
  const reads: string[] = [];
  const pending: Promise<unknown>[] = [];
  const env = edgeEnv(bucket(reads, { bytes: REWRITTEN, etag: "bbbb-2" }));
  for (let round = 0; round < 2; round += 1) {
    const response = await worker.fetch(await tileRequest("aaaa-2"), env, context(pending));
    await response.arrayBuffer();
    await Promise.all(pending);
    assert.equal(response.status, 206);
    assert.match(response.headers.get("Server-Timing") ?? "", /cache;desc=etag-mismatch/);
  }
  assert.equal(reads.length, 2);
  assert.equal(cache.entries.size, 0);
});

test("a token with the stored ETag is cached under that ETag", async () => {
  const cache = new MemoryCache();
  holder.caches = { default: cache };
  const pending: Promise<unknown>[] = [];
  const env = edgeEnv(bucket([], { bytes: BYTES, etag: "aaaa-2" }));
  const response = await worker.fetch(await tileRequest("aaaa-2"), env, context(pending));
  await response.arrayBuffer();
  await Promise.all(pending);
  assert.deepEqual(
    [...cache.entries.keys()].map((url) => new URL(url).searchParams.get("etag")),
    ["aaaa-2"],
  );
});
