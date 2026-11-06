import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createModelCache,
  describeModelLoad,
  hasOnnxProtobufHeader,
  type ModelCacheEntryStore,
  type ModelCacheStorage,
  ModelDownloadError,
  type ModelFetch,
} from "../../src/index.ts";

const modelUrl = "/models/pathosam.encoder_q4.onnx";

function fakeModel(size: number, seed = 1): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(size);
  bytes[0] = 0x08;
  bytes[1] = 8;
  for (let index = 2; index < size; index += 1) {
    bytes[index] = (index * 31 + seed) & 0xff;
  }
  return bytes;
}

class FakeEntryStore implements ModelCacheEntryStore {
  readonly entries = new Map<string, Response>();
  puts = 0;

  match(url: string): Promise<Response | undefined> {
    return Promise.resolve(this.entries.get(url)?.clone());
  }

  put(url: string, response: Response): Promise<void> {
    this.puts += 1;
    this.entries.set(url, response);
    return Promise.resolve();
  }

  delete(url: string): Promise<boolean> {
    return Promise.resolve(this.entries.delete(url));
  }
}

function fakeCaches(store: FakeEntryStore): ModelCacheStorage & { opened: string[] } {
  const opened: string[] = [];
  return {
    opened,
    open(name) {
      opened.push(name);
      return Promise.resolve(store);
    },
  };
}

interface FakeServer {
  readonly fetch: ModelFetch;
  readonly requests: { url: string; ifNoneMatch: string | undefined }[];
  body: Uint8Array;
  etag: string;
  declaredLength: number | null;
}

function fakeServer(body: Uint8Array, etag = '"v1"'): FakeServer {
  const server: FakeServer = {
    requests: [],
    body,
    etag,
    declaredLength: null,
    fetch: (url, init) => {
      const ifNoneMatch = init?.headers?.["If-None-Match"];
      server.requests.push({ url, ifNoneMatch });
      if (ifNoneMatch !== undefined && ifNoneMatch === server.etag) {
        return Promise.resolve(new Response(null, { status: 304, headers: { etag: server.etag } }));
      }
      return Promise.resolve(
        new Response(server.body.slice(), {
          status: 200,
          headers: {
            etag: server.etag,
            "content-length": String(server.declaredLength ?? server.body.length),
          },
        }),
      );
    },
  };
  return server;
}

describe("model cache first load", () => {
  it("downloads once, checks the header, stores the bytes and asks for persistent storage", async () => {
    const store = new FakeEntryStore();
    const server = fakeServer(fakeModel(2_500_000));
    let persistCalls = 0;
    const progress: number[] = [];
    const cache = createModelCache({
      caches: fakeCaches(store),
      fetch: server.fetch,
      storage: {
        persist: () => {
          persistCalls += 1;
          return Promise.resolve(true);
        },
      },
      onProgress: (received) => progress.push(received),
    });
    const load = await cache.load(modelUrl);
    assert.equal(load.source, "network");
    assert.equal(load.bytes.length, 2_500_000);
    assert.equal(load.downloadedBytes, 2_500_000);
    assert.equal(load.message, "Downloaded 3 MB");
    assert.equal(load.revalidation, null);
    assert.equal(load.replacedCorruptEntry, false);
    assert.equal(persistCalls, 1);
    assert.equal(store.puts, 1);
    assert.equal(store.entries.get(modelUrl)?.headers.get("etag"), '"v1"');
    assert.equal(progress.at(-1), 2_500_000);
  });

  it("asks for persistent storage only once across several models", async () => {
    const store = new FakeEntryStore();
    const server = fakeServer(fakeModel(4096));
    let persistCalls = 0;
    const cache = createModelCache({
      caches: fakeCaches(store),
      fetch: server.fetch,
      storage: {
        persist: () => {
          persistCalls += 1;
          return Promise.resolve(false);
        },
      },
    });
    await cache.load("/models/a.onnx");
    await cache.load("/models/b.onnx");
    assert.equal(persistCalls, 1);
    assert.equal(store.entries.size, 2);
  });

  it("works when persistent storage is missing or refuses", async () => {
    const store = new FakeEntryStore();
    const server = fakeServer(fakeModel(4096));
    const cache = createModelCache({
      caches: fakeCaches(store),
      fetch: server.fetch,
      storage: {
        persist: () => Promise.reject(new Error("denied")),
      },
    });
    const load = await cache.load(modelUrl);
    assert.equal(load.source, "network");
    assert.equal(store.entries.size, 1);
  });

  it("refuses an HTML error page and caches nothing", async () => {
    const store = new FakeEntryStore();
    const page = new TextEncoder().encode("<html>not found</html>");
    const server = fakeServer(page);
    const cache = createModelCache({ caches: fakeCaches(store), fetch: server.fetch });
    await assert.rejects(
      cache.load(modelUrl),
      (error) => error instanceof ModelDownloadError && error.reason === "not-onnx",
    );
    assert.equal(store.puts, 0);
  });

  it("refuses a download shorter than its declared length and a failing status", async () => {
    const store = new FakeEntryStore();
    const server = fakeServer(fakeModel(4096));
    server.declaredLength = 8192;
    const cache = createModelCache({ caches: fakeCaches(store), fetch: server.fetch });
    await assert.rejects(
      cache.load(modelUrl),
      (error) => error instanceof ModelDownloadError && error.reason === "truncated",
    );
    const failing = createModelCache({
      caches: fakeCaches(store),
      fetch: () => Promise.resolve(new Response("no", { status: 503 })),
    });
    await assert.rejects(
      failing.load(modelUrl),
      (error) => error instanceof ModelDownloadError && error.reason === "http",
    );
    assert.equal(store.puts, 0);
  });
});

describe("model cache cached load", () => {
  it("serves from the cache and confirms the ETag in the background", async () => {
    const store = new FakeEntryStore();
    const server = fakeServer(fakeModel(4096));
    const cache = createModelCache({ caches: fakeCaches(store), fetch: server.fetch });
    await cache.load(modelUrl);
    server.requests.length = 0;
    const load = await cache.load(modelUrl);
    assert.equal(load.source, "cache");
    assert.equal(load.downloadedBytes, 0);
    assert.equal(load.message, "Loaded from cache");
    assert.deepEqual(load.bytes, fakeModel(4096));
    assert.equal(await load.revalidation, "unchanged");
    assert.deepEqual(server.requests, [{ url: modelUrl, ifNoneMatch: '"v1"' }]);
    assert.equal(store.puts, 1);
  });

  it("replaces the entry when the server has a new version and serves it next time", async () => {
    const store = new FakeEntryStore();
    const server = fakeServer(fakeModel(4096, 1));
    const cache = createModelCache({ caches: fakeCaches(store), fetch: server.fetch });
    await cache.load(modelUrl);
    server.body = fakeModel(5000, 2);
    server.etag = '"v2"';
    const stale = await cache.load(modelUrl);
    assert.deepEqual(stale.bytes, fakeModel(4096, 1));
    assert.equal(await stale.revalidation, "updated");
    const fresh = await cache.load(modelUrl);
    assert.equal(fresh.source, "cache");
    assert.deepEqual(fresh.bytes, fakeModel(5000, 2));
    assert.equal(await fresh.revalidation, "unchanged");
  });

  it("keeps the cached model when revalidation fails or brings a bad body", async () => {
    const store = new FakeEntryStore();
    const server = fakeServer(fakeModel(4096));
    const cache = createModelCache({ caches: fakeCaches(store), fetch: server.fetch });
    await cache.load(modelUrl);
    const offline = createModelCache({
      caches: fakeCaches(store),
      fetch: () => Promise.reject(new Error("offline")),
    });
    const first = await offline.load(modelUrl);
    assert.equal(first.source, "cache");
    assert.equal(await first.revalidation, "failed");

    const bad = fakeServer(new TextEncoder().encode("<html></html>"), '"v9"');
    const second = await createModelCache({ caches: fakeCaches(store), fetch: bad.fetch }).load(
      modelUrl,
    );
    assert.equal(await second.revalidation, "failed");
    assert.deepEqual((await store.match(modelUrl))?.headers.get("etag"), '"v1"');
  });

  it("opens the named cache", async () => {
    const store = new FakeEntryStore();
    const server = fakeServer(fakeModel(4096));
    const caches = fakeCaches(store);
    const cache = createModelCache({ caches, fetch: server.fetch, cacheName: "models-test" });
    await cache.load(modelUrl);
    assert.deepEqual(caches.opened, ["models-test"]);
    assert.equal(describeModelLoad("network", 98_400_000), "Downloaded 98 MB");
  });
});

describe("model cache corrupted entry", () => {
  it("drops an entry whose header is not ONNX and downloads a fresh copy", async () => {
    const store = new FakeEntryStore();
    store.entries.set(
      modelUrl,
      new Response(new TextEncoder().encode("<html>captive portal</html>"), {
        headers: { etag: '"v1"' },
      }),
    );
    const server = fakeServer(fakeModel(4096));
    const cache = createModelCache({ caches: fakeCaches(store), fetch: server.fetch });
    const load = await cache.load(modelUrl);
    assert.equal(load.source, "network");
    assert.equal(load.replacedCorruptEntry, true);
    assert.equal(load.message, "Downloaded 1 MB");
    assert.deepEqual(load.bytes, fakeModel(4096));
    const stored = await store.match(modelUrl);
    assert.deepEqual(
      new Uint8Array((await stored?.arrayBuffer()) ?? new ArrayBuffer(0)),
      fakeModel(4096),
    );
  });

  it("drops an entry that is shorter than the length it recorded", async () => {
    const store = new FakeEntryStore();
    store.entries.set(
      modelUrl,
      new Response(fakeModel(1000), { headers: { "content-length": "4096", etag: '"v1"' } }),
    );
    const server = fakeServer(fakeModel(4096));
    const cache = createModelCache({ caches: fakeCaches(store), fetch: server.fetch });
    const load = await cache.load(modelUrl);
    assert.equal(load.source, "network");
    assert.equal(load.replacedCorruptEntry, true);
    assert.equal(server.requests.length, 1);
    assert.equal(server.requests[0]?.ifNoneMatch, undefined);
  });

  it("surfaces the error and leaves no entry when the replacement is also bad", async () => {
    const store = new FakeEntryStore();
    store.entries.set(modelUrl, new Response(new Uint8Array([0x3c, 0x68])));
    const bad = fakeServer(new Uint8Array([0x00, 0x01, 0x02]));
    const cache = createModelCache({ caches: fakeCaches(store), fetch: bad.fetch });
    await assert.rejects(cache.load(modelUrl), ModelDownloadError);
    assert.equal(store.entries.size, 0);
  });
});

describe("protobuf header check", () => {
  it("accepts an ir_version first and the other ModelProto fields", () => {
    assert.equal(hasOnnxProtobufHeader(new Uint8Array([0x08, 0x08, 0x12])), true);
    assert.equal(hasOnnxProtobufHeader(new Uint8Array([0x12, 0x07, 0x70])), true);
    assert.equal(hasOnnxProtobufHeader(new Uint8Array([0x3a, 0x80, 0x01])), true);
  });

  it("rejects empty, text, JSON, an absurd ir_version and a wrong wire type", () => {
    assert.equal(hasOnnxProtobufHeader(new Uint8Array([])), false);
    assert.equal(hasOnnxProtobufHeader(new TextEncoder().encode("<!DOCTYPE html>")), false);
    assert.equal(hasOnnxProtobufHeader(new TextEncoder().encode('{"error":1}')), false);
    assert.equal(hasOnnxProtobufHeader(new Uint8Array([0x08, 0x00])), false);
    assert.equal(hasOnnxProtobufHeader(new Uint8Array([0x08, 0x64])), false);
    assert.equal(hasOnnxProtobufHeader(new Uint8Array([0x0a, 0x08])), false);
  });
});
