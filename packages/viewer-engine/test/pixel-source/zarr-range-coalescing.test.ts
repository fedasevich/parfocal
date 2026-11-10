import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import * as zarr from "zarrita";
import { type LatencyProxy, startLatencyProxy } from "../../../latency-proxy/src/index.ts";
import { openOmeZarrSource } from "../../src/index.ts";
import { serve } from "./serve.ts";
import { writeZarrFixture } from "./zarr-fixture.ts";

const size = 2048;
const chunk = 256;
const shard = 4;
const rttMs = 20;
const window = [0, 0, size, size] as const;
const innerChunks = (size / chunk) ** 2;
const shards = (size / (chunk * shard)) ** 2;

const common = {
  dtype: "uint8",
  channels: 3,
  width: size,
  height: size,
  chunk,
  levels: 1,
} as const;
const plain = await writeZarrFixture({ ...common, version: 3 });
const sharded = await writeZarrFixture({ ...common, version: 3, shard });
const served = await serve({ "/plain": plain.root, "/sharded": sharded.root });
const proxy: LatencyProxy = await startLatencyProxy({ target: served.origin, rttMs });

after(async () => {
  await proxy.close();
  await served.close();
  await plain.remove();
  await sharded.remove();
});

interface Count {
  readonly requests: number;
  readonly bytes: number;
  readonly methods: Readonly<Record<string, number>>;
}

function counted(): Count {
  const { requests, bytes, methods } = proxy.stats();
  return { requests, bytes, methods };
}

async function rawRead(mount: string): Promise<Count> {
  const store = new zarr.FetchStore(`${proxy.url}${mount}`);
  const array = await zarr.open.v3(zarr.root(store).resolve("0"), { kind: "array" });
  proxy.resetStats();
  await zarr.get(array, [null, zarr.slice(window[1], window[3]), zarr.slice(window[0], window[2])]);
  return counted();
}

async function sourceRead(mount: string): Promise<{ count: Count; value: number }> {
  const source = await openOmeZarrSource({ formatId: "ome-zarr", url: `${proxy.url}${mount}` });
  assert.equal(source.tileSize.width, chunk);
  proxy.resetStats();
  const result = await source.getRaster({ level: 0, window: [...window] });
  const count = counted();
  source.close();
  assert.equal(result.absent, false);
  const plane = result.absent ? undefined : result.planes[1];
  return { count, value: plane?.[777 * size + 1500] ?? -1 };
}

describe("range coalescing for sharded OME-Zarr 0.5 over the latency proxy", () => {
  it("reads a viewport of a sharded store in one request per shard plus its index", async () => {
    const unsharded = await rawRead("/plain");
    const uncoalesced = await rawRead("/sharded");
    const viaSourcePlain = await sourceRead("/plain");
    const viaSourceSharded = await sourceRead("/sharded");
    console.log(
      JSON.stringify({
        rttMs,
        innerChunks,
        shards,
        unsharded,
        uncoalesced,
        viaSourcePlain,
        viaSourceSharded,
      }),
    );
    assert.equal(unsharded.requests, innerChunks);
    assert.equal(uncoalesced.requests, innerChunks + 2 * shards);
    assert.equal(viaSourcePlain.count.requests, innerChunks);
    assert.equal(viaSourceSharded.count.requests, 2 * shards);
    assert.deepEqual(viaSourceSharded.count.methods, { GET: 2 * shards });
    assert.ok(viaSourceSharded.count.requests * 4 <= unsharded.requests);
    assert.equal(viaSourceSharded.value, sharded.value(0, 1, 1500, 777));
  });

  it("coalesces the tiles of a viewport asked for together", async () => {
    const source = await openOmeZarrSource({ formatId: "ome-zarr", url: `${proxy.url}/sharded` });
    const side = size / chunk;
    proxy.resetStats();
    const tiles = await Promise.all(
      Array.from({ length: innerChunks }, (_, number) =>
        source.getTile({ level: 0, x: number % side, y: Math.floor(number / side) }),
      ),
    );
    const count = counted();
    source.close();
    console.log(JSON.stringify({ tiles: innerChunks, count }));
    assert.ok(tiles.every((tile) => !tile.absent));
    assert.equal(count.requests, 2 * shards);
  });
});
