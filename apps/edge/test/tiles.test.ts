import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, mock, test } from "node:test";
import {
  type Capability,
  overlapsRestricted,
  signCapability,
  signingKey,
  verifyCapability,
} from "../src/capability.ts";
import {
  consoleTileLog,
  handleTiles,
  type RangeCache,
  type TileEnv,
  type TileRead,
} from "../src/tiles.ts";

type Vector = {
  secret: string;
  token: string;
  claims: { t: string; s: string; o: string; n: number; d: [number, number][]; e: number };
};

const vector = JSON.parse(
  readFileSync(`${import.meta.dirname}/capability-vector.json`, "utf8"),
) as Vector;
const SECRET = vector.secret;
const OTHER_SECRET = btoa("x".repeat(32));
const TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT = "22222222-2222-4222-8222-222222222222";
const SLIDE = "33333333-3333-4333-8333-333333333333";
const OTHER_SLIDE = "44444444-4444-4444-8444-444444444444";
const NOW = 1_800_000_000;
const SIZE = 10_000;
const LABEL: [number, number] = [4000, 5000];
const logged: TileRead[] = [];

function bytesOf(size: number, seed: number): Uint8Array {
  return Uint8Array.from({ length: size }, (_, index) => (index * 7 + seed) % 251);
}

class FakeBucket {
  readonly objects = new Map<string, Uint8Array>();
  readonly reads: string[] = [];

  put(key: string, bytes: Uint8Array): void {
    this.objects.set(key, bytes);
  }

  head(key: string) {
    const bytes = this.objects.get(key);
    return Promise.resolve(bytes === undefined ? null : this.meta(key, bytes));
  }

  get(key: string, options: { range?: { offset?: number; length?: number; suffix?: number } }) {
    return Promise.resolve(this.read(key, options.range));
  }

  private read(key: string, range?: { offset?: number; length?: number; suffix?: number }) {
    this.reads.push(key);
    const bytes = this.objects.get(key);
    if (bytes === undefined) {
      return null;
    }
    let start = 0;
    let end = bytes.length;
    if (range?.suffix !== undefined) {
      start = Math.max(0, bytes.length - range.suffix);
    } else if (range?.offset !== undefined) {
      start = range.offset;
      end = Math.min(bytes.length, start + (range.length ?? bytes.length));
    }
    return { ...this.meta(key, bytes), body: new Blob([bytes.slice(start, end)]).stream() };
  }

  private meta(key: string, bytes: Uint8Array) {
    return { key, size: bytes.length, httpEtag: `"${key.length}"`, httpMetadata: {} };
  }
}

function capability(overrides: Partial<Capability> = {}): Capability {
  return {
    tenant: TENANT,
    slide: SLIDE,
    original: "original.svs",
    size: SIZE,
    restricted: [LABEL],
    expires: NOW + 600,
    ...overrides,
  };
}

async function tokenFor(overrides: Partial<Capability> = {}, secret = SECRET): Promise<string> {
  return signCapability(capability(overrides), await signingKey(secret));
}

function lab(): FakeBucket {
  const bucket = new FakeBucket();
  bucket.put(`t/${TENANT}/s/${SLIDE}/original.svs`, bytesOf(SIZE, 1));
  bucket.put(`t/${TENANT}/s/${SLIDE}/levels.json`, new TextEncoder().encode("[]"));
  bucket.put(`t/${OTHER_TENANT}/s/${OTHER_SLIDE}/original.svs`, bytesOf(SIZE, 2));
  bucket.put(`t/${TENANT}/restricted/${SLIDE}/label.png`, bytesOf(100, 3));
  return bucket;
}

async function request(
  bucket: FakeBucket,
  path: string,
  token: string | null,
  range?: string,
  now = NOW,
  method = "GET",
): Promise<Response> {
  const headers = new Headers();
  if (token !== null) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  if (range !== undefined) {
    headers.set("Range", range);
  }
  const env = { SLIDES: bucket as unknown as R2Bucket, TILE_TOKEN_KEY: SECRET } satisfies TileEnv;
  return handleTiles(
    new Request(`https://parfocal.test${path}`, { method, headers }),
    env,
    () => now,
    (read) => logged.push(read),
  );
}

async function code(response: Response): Promise<string> {
  const body: { code: string } = await response.json();
  return body.code;
}

const ORIGINAL = `/tiles/${SLIDE}/original.svs`;

describe("capability tokens", () => {
  test("the API and the edge sign the same claims to the same token", async () => {
    const { claims } = vector;
    const signed = await signCapability(
      {
        tenant: claims.t,
        slide: claims.s,
        original: claims.o,
        size: claims.n,
        restricted: claims.d,
        expires: claims.e,
      },
      await signingKey(SECRET),
    );
    assert.equal(signed, vector.token);
    const verdict = await verifyCapability(vector.token, await signingKey(SECRET), claims.e - 1);
    assert.ok(verdict.ok);
    assert.equal(verdict.capability.tenant, claims.t);
  });

  test("a token is refused once it expires", async () => {
    const key = await signingKey(SECRET);
    const token = await tokenFor();
    assert.deepEqual(await verifyCapability(token, key, NOW + 600), {
      ok: false,
      reason: "expired",
    });
  });

  test("a token signed with another key or edited is refused", async () => {
    const key = await signingKey(SECRET);
    const forged = await tokenFor({}, OTHER_SECRET);
    assert.deepEqual(await verifyCapability(forged, key, NOW), {
      ok: false,
      reason: "bad-signature",
    });
    const [payload = "", signature = ""] = (await tokenFor()).split(".");
    const edited = `${payload.slice(0, -2)}${payload.endsWith("A") ? "B" : "A"}${payload.slice(-1)}.${signature}`;
    assert.equal((await verifyCapability(edited, key, NOW)).ok, false);
    assert.deepEqual(await verifyCapability("nonsense", key, NOW), {
      ok: false,
      reason: "malformed",
    });
  });

  test("a token with bad base64 or a missing part is malformed, never a thrown error", async () => {
    const key = await signingKey(SECRET);
    const [payload = "", signature = ""] = (await tokenFor()).split(".");
    for (const token of [
      "a.b",
      "a.",
      ".b",
      "",
      ".",
      `${payload}.`,
      `.${signature}`,
      `${payload}`,
    ]) {
      assert.deepEqual(await verifyCapability(token, key, NOW), { ok: false, reason: "malformed" });
    }
    for (const token of [`${payload}.a`, `a.${signature}`, `${payload}.${signature}+`, "a=b.c"]) {
      assert.deepEqual(await verifyCapability(token, key, NOW), { ok: false, reason: "malformed" });
    }
  });

  test("a well formed token with a wrong signature is a bad signature", async () => {
    const key = await signingKey(SECRET);
    const [payload = ""] = (await tokenFor()).split(".");
    assert.deepEqual(await verifyCapability(`${payload}.AAAA`, key, NOW), {
      ok: false,
      reason: "bad-signature",
    });
  });

  test("ranges that only touch a restricted range do not overlap it", () => {
    assert.equal(overlapsRestricted([LABEL], 0, 4000), false);
    assert.equal(overlapsRestricted([LABEL], 5000, 6000), false);
    assert.equal(overlapsRestricted([LABEL], 3999, 4001), true);
    assert.equal(overlapsRestricted([LABEL], 4999, 5001), true);
    assert.equal(overlapsRestricted([LABEL], 0, 10_000), true);
  });
});

describe("the tile gateway", () => {
  test("serves a byte range of the slide named in the token", async () => {
    const bucket = lab();
    const response = await request(bucket, ORIGINAL, await tokenFor(), "bytes=0-99");
    assert.equal(response.status, 206);
    assert.equal(response.headers.get("Content-Range"), `bytes 0-99/${SIZE}`);
    const body = new Uint8Array(await response.arrayBuffer());
    assert.deepEqual(body, bytesOf(SIZE, 1).slice(0, 100));
    assert.deepEqual(bucket.reads, [`t/${TENANT}/s/${SLIDE}/original.svs`]);
  });

  test("serves the slide's derived files whole", async () => {
    const response = await request(lab(), `/tiles/${SLIDE}/levels.json`, await tokenFor());
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "[]");
  });

  test("refuses a missing, forged or expired token", async () => {
    const bucket = lab();
    const missing = await request(bucket, ORIGINAL, null, "bytes=0-99");
    assert.equal(missing.status, 401);
    assert.equal(await code(missing), "tile-token-missing");
    const forged = await request(bucket, ORIGINAL, await tokenFor({}, OTHER_SECRET), "bytes=0-9");
    assert.equal(forged.status, 401);
    assert.equal(await code(forged), "tile-token-invalid");
    const expired = await request(bucket, ORIGINAL, await tokenFor(), "bytes=0-9", NOW + 600);
    assert.equal(expired.status, 401);
    assert.equal(await code(expired), "tile-token-expired");
    assert.deepEqual(bucket.reads, []);
  });

  test("refuses a malformed token with 401, never 500", async () => {
    const bucket = lab();
    const [payload = "", signature = ""] = (await tokenFor()).split(".");
    for (const token of ["a.b", `${payload}.a`, `a.${signature}`, payload, `${payload}.AAAA`]) {
      const response = await request(bucket, ORIGINAL, token, "bytes=0-9");
      assert.equal(response.status, 401, token);
      assert.equal(await code(response), "tile-token-invalid");
    }
    assert.deepEqual(bucket.reads, []);
  });

  test("never reads another tenant's slide", async () => {
    const bucket = lab();
    const otherSlide = await request(
      bucket,
      `/tiles/${OTHER_SLIDE}/original.svs`,
      await tokenFor(),
      "bytes=0-9",
    );
    assert.equal(otherSlide.status, 403);
    assert.equal(await code(otherSlide), "tile-token-other-slide");
    const forgedTenant = await request(
      bucket,
      `/tiles/${OTHER_SLIDE}/original.svs`,
      await tokenFor({ tenant: OTHER_TENANT, slide: OTHER_SLIDE }, OTHER_SECRET),
      "bytes=0-9",
    );
    assert.equal(forgedTenant.status, 401);
    assert.deepEqual(bucket.reads, []);
  });

  test("a token of another tenant reads only that tenant's keys", async () => {
    const bucket = lab();
    const response = await request(
      bucket,
      `/tiles/${SLIDE}/original.svs`,
      await tokenFor({ tenant: OTHER_TENANT }),
      "bytes=0-9",
    );
    assert.equal(response.status, 404);
    assert.deepEqual(bucket.reads, [`t/${OTHER_TENANT}/s/${SLIDE}/original.svs`]);
  });

  test("refuses every range that overlaps a label or macro page", async () => {
    const bucket = lab();
    const token = await tokenFor();
    for (const range of ["bytes=3990-4010", "bytes=4500-4600", "bytes=4999-", "bytes=-6000"]) {
      const response = await request(bucket, ORIGINAL, token, range);
      assert.equal(response.status, 403, range);
      assert.equal(await code(response), "range-restricted");
    }
    const whole = await request(bucket, ORIGINAL, token);
    assert.equal(whole.status, 403);
    assert.deepEqual(bucket.reads, []);
    assert.equal((await request(bucket, ORIGINAL, token, "bytes=0-3999")).status, 206);
    assert.equal((await request(bucket, ORIGINAL, token, "bytes=5000-5999")).status, 206);
    assert.equal((await request(bucket, ORIGINAL, token, "bytes=-5000")).status, 206);
  });

  test("answers a HEAD request with the size and no bytes", async () => {
    const response = await request(lab(), ORIGINAL, await tokenFor(), undefined, NOW, "HEAD");
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Content-Length"), String(SIZE));
  });

  test("refuses several ranges at once and names that are not one file", async () => {
    const bucket = lab();
    const token = await tokenFor();
    assert.equal((await request(bucket, ORIGINAL, token, "bytes=0-9,20-29")).status, 416);
    const climbing = await request(bucket, `/tiles/${SLIDE}/../restricted/label.png`, token);
    assert.equal(climbing.status, 403);
    for (const path of [
      `/tiles/${SLIDE}/%2E%2E`,
      `/tiles/${SLIDE}/.hidden`,
      `/tiles/${SLIDE}/a/b`,
    ]) {
      assert.equal((await request(bucket, path, token)).status, 404, path);
    }
    assert.deepEqual(bucket.reads, []);
  });
});

describe("tile access logs", () => {
  test("every served tile request logs the tenant id and slide id and nothing else", async () => {
    const bucket = lab();
    const token = await tokenFor();
    logged.length = 0;
    await request(bucket, ORIGINAL, token, "bytes=0-99");
    await request(bucket, ORIGINAL, token, "bytes=6000-6999");
    await request(bucket, `/tiles/${SLIDE}/levels.json`, token, undefined, NOW, "HEAD");
    await request(bucket, ORIGINAL, token, `bytes=${LABEL[0]}-${LABEL[1]}`);
    assert.deepEqual(logged, Array(4).fill({ tenant: TENANT, slide: SLIDE }));
    assert.ok(logged.every((read) => Object.keys(read).join() === "tenant,slide"));
  });

  test("a request without a valid token for the slide logs nothing", async () => {
    const bucket = lab();
    logged.length = 0;
    await request(bucket, ORIGINAL, null);
    await request(bucket, ORIGINAL, await tokenFor({}, OTHER_SECRET));
    await request(bucket, ORIGINAL, await tokenFor(), undefined, NOW + 601);
    await request(bucket, `/tiles/${OTHER_SLIDE}/original.svs`, await tokenFor());
    assert.deepEqual(logged, []);
  });

  test("the Worker writes one JSON line with only the two ids", () => {
    const lines: unknown[][] = [];
    const spy = mock.method(console, "log", (...line: unknown[]) => lines.push(line));
    try {
      consoleTileLog({ tenant: TENANT, slide: SLIDE, token: "secret" } as TileRead);
    } finally {
      spy.mock.restore();
    }
    assert.deepEqual(lines, [[JSON.stringify({ tenant: TENANT, slide: SLIDE })]]);
  });
});

class FakeCache {
  readonly entries = new Map<string, { bytes: Uint8Array; headers: Headers }>();
  readonly puts: string[] = [];
  readonly pending: Promise<unknown>[] = [];

  match(request: Request) {
    const entry = this.entries.get(request.url);
    return Promise.resolve(
      entry === undefined
        ? undefined
        : new Response(entry.bytes.slice(), { headers: entry.headers }),
    );
  }

  async put(request: Request, response: Response) {
    assert.equal(response.status, 200);
    assert.match(response.headers.get("Cache-Control") ?? "", /^public/);
    this.puts.push(request.url);
    const bytes = new Uint8Array(await response.arrayBuffer());
    this.entries.set(request.url, { bytes, headers: new Headers(response.headers) });
  }

  layer(): RangeCache {
    return {
      store: this as unknown as Cache,
      keep: (work) => {
        this.pending.push(work);
      },
    };
  }
}

async function cachedRequest(
  bucket: FakeBucket,
  cache: FakeCache,
  path: string,
  token: string,
  range?: string,
  method = "GET",
): Promise<Response> {
  const headers = new Headers({ Authorization: `Bearer ${token}` });
  if (range !== undefined) {
    headers.set("Range", range);
  }
  const env = { SLIDES: bucket as unknown as R2Bucket, TILE_TOKEN_KEY: SECRET } satisfies TileEnv;
  const response = await handleTiles(
    new Request(`https://parfocal.test${path}`, { method, headers }),
    env,
    () => NOW,
    () => undefined,
    cache.layer(),
  );
  await Promise.all(cache.pending);
  return response;
}

describe("the byte range cache", () => {
  test("a repeated range is served from the cache with the same bytes and range", async () => {
    const bucket = lab();
    const cache = new FakeCache();
    const token = await tokenFor();
    const first = await cachedRequest(bucket, cache, ORIGINAL, token, "bytes=100-199");
    const firstBytes = new Uint8Array(await first.arrayBuffer());
    await Promise.all(cache.pending);
    const second = await cachedRequest(bucket, cache, ORIGINAL, token, "bytes=100-199");
    assert.equal(second.status, 206);
    assert.equal(second.headers.get("Content-Range"), `bytes 100-199/${SIZE}`);
    assert.equal(second.headers.get("Cache-Control"), "private, max-age=3600");
    assert.match(second.headers.get("Server-Timing") ?? "", /cache;desc=hit/);
    assert.deepEqual(new Uint8Array(await second.arrayBuffer()), firstBytes);
    assert.deepEqual(firstBytes, bytesOf(SIZE, 1).slice(100, 200));
    assert.equal(bucket.reads.length, 1);
    assert.equal(cache.puts.length, 1);
    assert.ok(!(cache.puts[0] ?? "").includes(token));
  });

  test("a whole file is cached once and served whole", async () => {
    const bucket = lab();
    const cache = new FakeCache();
    const token = await tokenFor();
    const path = `/tiles/${SLIDE}/levels.json`;
    await (await cachedRequest(bucket, cache, path, token)).arrayBuffer();
    await Promise.all(cache.pending);
    const second = await cachedRequest(bucket, cache, path, token);
    assert.equal(second.status, 200);
    assert.equal(await second.text(), "[]");
    assert.equal(bucket.reads.length, 1);
  });

  test("suffix and open ended ranges skip the cache", async () => {
    const bucket = lab();
    const cache = new FakeCache();
    const token = await tokenFor();
    const suffix = await cachedRequest(bucket, cache, ORIGINAL, token, "bytes=-100");
    const open = await cachedRequest(bucket, cache, ORIGINAL, token, "bytes=9900-");
    assert.equal(suffix.status, 206);
    assert.equal(open.status, 206);
    assert.equal(cache.puts.length, 0);
  });

  test("a restricted range is refused before the cache is touched", async () => {
    const bucket = lab();
    const cache = new FakeCache();
    const token = await tokenFor();
    const response = await cachedRequest(bucket, cache, ORIGINAL, token, "bytes=4500-4599");
    assert.equal(response.status, 403);
    assert.equal(cache.puts.length, 0);
    assert.equal(bucket.reads.length, 0);
  });

  test("HEAD and missing files are never cached", async () => {
    const bucket = lab();
    const cache = new FakeCache();
    const token = await tokenFor();
    const head = await cachedRequest(bucket, cache, ORIGINAL, token, undefined, "HEAD");
    const missing = await cachedRequest(bucket, cache, `/tiles/${SLIDE}/nothing.bin`, token);
    assert.equal(head.status, 200);
    assert.equal(missing.status, 404);
    assert.equal(cache.puts.length, 0);
  });
});
