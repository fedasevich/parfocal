import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { ChecksumError, downloadFixture, type RemoteFixture } from "../src/index.ts";

const body = Buffer.from("synthetic slide bytes ".repeat(4096));
const sha256 = createHash("sha256").update(body).digest("hex");

type Behaviour = { honourRange: boolean; failFirst: number; truncateAt: number | undefined };

let server: Server;
let dir: string;
let requests: IncomingHttpHeaders[];
let behaviour: Behaviour;

function fixture(overrides: Partial<RemoteFixture> = {}): RemoteFixture {
  const { port } = server.address() as AddressInfo;
  return {
    file: "slide.svs",
    url: `http://127.0.0.1:${port}/slide.svs`,
    sha256,
    bytes: body.length,
    groups: ["small"],
    ...overrides,
  };
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "fixtures-"));
  requests = [];
  behaviour = { honourRange: true, failFirst: 0, truncateAt: undefined };
  server = createServer((request, response) => {
    requests.push(request.headers);
    if (requests.length <= behaviour.failFirst) {
      response.destroy();
      return;
    }
    const range = /^bytes=(\d+)-$/.exec(request.headers.range ?? "");
    const start = behaviour.honourRange && range?.[1] ? Number(range[1]) : 0;
    const end = behaviour.truncateAt ?? body.length;
    behaviour.truncateAt = undefined;
    response.writeHead(start > 0 ? 206 : 200);
    response.end(body.subarray(start, end));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rm(dir, { recursive: true, force: true });
});

test("downloads, verifies and then serves from the cache", async () => {
  assert.equal(await downloadFixture(fixture(), dir), "downloaded");
  assert.deepEqual(await readFile(join(dir, "slide.svs")), body);
  assert.equal((await readFile(join(dir, "slide.svs.sha256"), "utf8")).trim(), sha256);
  assert.equal(await downloadFixture(fixture(), dir), "cached");
  assert.equal(requests.length, 1);
});

test("a checksum mismatch fails and leaves nothing behind", async () => {
  await assert.rejects(downloadFixture(fixture({ sha256: "f".repeat(64) }), dir), ChecksumError);
  assert.equal(existsSync(join(dir, "slide.svs")), false);
  assert.equal(existsSync(join(dir, "slide.svs.part")), false);
});

test("resumes a partial download with a range request", async () => {
  await writeFile(join(dir, "slide.svs.part"), body.subarray(0, 1000));
  assert.equal(await downloadFixture(fixture(), dir), "downloaded");
  assert.equal(requests[0]?.range, "bytes=1000-");
  assert.deepEqual(await readFile(join(dir, "slide.svs")), body);
});

test("restarts when the server ignores the range", async () => {
  behaviour.honourRange = false;
  await writeFile(join(dir, "slide.svs.part"), body.subarray(0, 1000));
  assert.equal(await downloadFixture(fixture(), dir), "downloaded");
  assert.deepEqual(await readFile(join(dir, "slide.svs")), body);
});

test("retries dropped connections and short bodies", async () => {
  behaviour.failFirst = 1;
  behaviour.truncateAt = 5000;
  assert.equal(await downloadFixture(fixture(), dir), "downloaded");
  assert.equal(requests.length, 3);
  assert.equal(requests[2]?.range, "bytes=5000-");
  assert.deepEqual(await readFile(join(dir, "slide.svs")), body);
});

test("replaces a cached file whose bytes no longer match", async () => {
  await writeFile(join(dir, "slide.svs"), Buffer.alloc(body.length));
  assert.equal(await downloadFixture(fixture(), dir), "downloaded");
  assert.deepEqual(await readFile(join(dir, "slide.svs")), body);
});

test("gives up after the allowed attempts", async () => {
  behaviour.failFirst = 10;
  await assert.rejects(downloadFixture(fixture(), dir, { attempts: 2 }));
  assert.equal(requests.length, 2);
});

test("links a verified local copy instead of downloading", async () => {
  const local = join(dir, "poc");
  await mkdir(local);
  await writeFile(join(local, "slide.svs"), body);
  const cache = join(dir, "cache");
  assert.equal(await downloadFixture(fixture(), cache, { localDirs: [local] }), "linked");
  assert.equal((await lstat(join(cache, "slide.svs"))).isSymbolicLink(), true);
  assert.deepEqual(await readFile(join(cache, "slide.svs")), body);
  assert.equal(await downloadFixture(fixture(), cache, { localDirs: [local] }), "cached");
  assert.equal(requests.length, 0);
});

test("downloads when the local copy is corrupt", async () => {
  const local = join(dir, "poc");
  await mkdir(local);
  await writeFile(join(local, "slide.svs"), Buffer.alloc(body.length));
  const cache = join(dir, "cache");
  assert.equal(await downloadFixture(fixture(), cache, { localDirs: [local] }), "downloaded");
  assert.equal((await lstat(join(cache, "slide.svs"))).isSymbolicLink(), false);
  assert.equal(requests.length, 1);
});
