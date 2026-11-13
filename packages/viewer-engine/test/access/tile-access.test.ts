import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { signCapability, signingKey, verifyCapability } from "@parfocal/edge/capability";
import { type Fetcher, TileAccess } from "../../src/access/tile-access.ts";

const SECRET = btoa("k".repeat(32));
const OTHER_SECRET = btoa("o".repeat(32));
const LIFETIME_SECONDS = 600;
const START_MS = 1_800_000_000_000;
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const URL = "/tiles/slide/original.svs";

class Lab {
  nowMs = START_MS;
  mints = 0;
  readonly previous: (string | null)[] = [];
  readonly issued: string[] = [];
  secret = SECRET;
  readonly refusals: string[] = [];

  readonly clock = () => this.nowMs;

  readonly mint = async (previous: string | null) => {
    this.mints += 1;
    this.previous.push(previous);
    const token = await signCapability(
      {
        tenant: "tenant",
        slide: "slide",
        original: "original.svs",
        size: 1000,
        restricted: [],
        expires: Math.floor(this.nowMs / 1000) + LIFETIME_SECONDS,
      },
      await signingKey(this.secret),
    );
    this.issued.push(token);
    return { token, lifetimeSeconds: LIFETIME_SECONDS };
  };

  readonly edge: Fetcher = async (_input, init) => {
    const header = new Headers(init.headers).get("Authorization") ?? "";
    const access = await verifyCapability(
      header.replace(/^Bearer /, ""),
      await signingKey(SECRET),
      Math.floor(this.nowMs / 1000),
    );
    if (!access.ok) {
      this.refusals.push(access.reason);
      return new Response(null, { status: 401 });
    }
    return new Response("tile", { status: 206 });
  };
}

async function viewFor(lab: Lab, access: TileAccess, durationMs: number, everyMs: number) {
  const statuses: number[] = [];
  for (let elapsed = 0; elapsed <= durationMs; elapsed += everyMs) {
    lab.nowMs = START_MS + elapsed;
    statuses.push((await access.fetch(URL, {}, lab.edge)).status);
  }
  return statuses;
}

describe("tile access", () => {
  test("a two-hour viewing session never fails a tile", async () => {
    const lab = new Lab();
    const access = new TileAccess(lab.mint, lab.clock);
    const statuses = await viewFor(lab, access, TWO_HOURS_MS, 1_000);
    assert.equal(statuses.length, TWO_HOURS_MS / 1_000 + 1);
    assert.ok(statuses.every((status) => status === 206));
    assert.deepEqual(lab.refusals, []);
    assert.ok(lab.mints >= TWO_HOURS_MS / (LIFETIME_SECONDS * 1000));
    assert.ok(lab.mints <= (2 * TWO_HOURS_MS) / (LIFETIME_SECONDS * 1000) + 1);
  });

  test("byte reads skip the browser cache, whose per-URL lock would queue parallel ranges", async () => {
    const seen: RequestInit[] = [];
    const access = new TileAccess(() =>
      Promise.resolve({ token: "t", lifetimeSeconds: LIFETIME_SECONDS }),
    );
    const edge: Fetcher = (_input, init) => {
      seen.push(init);
      return Promise.resolve(new Response(null, { status: 206 }));
    };
    await access.fetch(URL, { headers: { range: "bytes=0-9" } }, edge);
    await access.fetch(URL, { cache: "default" }, edge);
    assert.equal(seen[0]?.cache, "no-store");
    assert.equal(new Headers(seen[0]?.headers).get("range"), "bytes=0-9");
    assert.equal(seen[1]?.cache, "default");
  });

  test("a viewer left idle past the lifetime gets a fresh token before its next tile", async () => {
    const lab = new Lab();
    const access = new TileAccess(lab.mint, lab.clock);
    const gaps = [0, 25 * 60_000, 70 * 60_000, 120 * 60_000];
    for (const at of gaps) {
      lab.nowMs = START_MS + at;
      assert.equal((await access.fetch(URL, {}, lab.edge)).status, 206);
    }
    assert.deepEqual(lab.refusals, []);
    assert.equal(lab.mints, gaps.length);
  });

  test("many tiles at once share one refresh", async () => {
    const lab = new Lab();
    const access = new TileAccess(lab.mint, lab.clock);
    await access.fetch(URL, {}, lab.edge);
    lab.nowMs += 6 * 60_000;
    const statuses = await Promise.all(
      Array.from({ length: 20 }, () => access.fetch(URL, {}, lab.edge)),
    );
    assert.ok(statuses.every((response) => response.status === 206));
    assert.equal(lab.mints, 2);
  });

  test("each renewal hands back the token it replaces, so the API audits one open", async () => {
    const lab = new Lab();
    const access = new TileAccess(lab.mint, lab.clock);
    await viewFor(lab, access, TWO_HOURS_MS, 7_000);
    await access.token();
    assert.ok(lab.mints > 2);
    assert.deepEqual(lab.previous, [null, ...lab.issued.slice(0, -1)]);
  });

  test("a refused token is replaced and the tile asked again once", async () => {
    const lab = new Lab();
    lab.secret = OTHER_SECRET;
    const access = new TileAccess(lab.mint, lab.clock);
    await access.token();
    lab.secret = SECRET;
    assert.equal((await access.fetch(URL, {}, lab.edge)).status, 206);
    assert.deepEqual(lab.refusals, ["bad-signature"]);
    assert.equal(lab.mints, 2);
  });
});
