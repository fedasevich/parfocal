import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { openOmeZarrSource, type PixelSource } from "../../src/index.ts";

const host = "https://uk1s3.embassy.ebi.ac.uk/idr";

const samples = {
  "OME-Zarr 0.4, blosc lz4 chunks": `${host}/zarr/v0.4/idr0062A/6001240.zarr`,
  "OME-Zarr 0.5, shards of blosc zstd chunks": `${host}/share/ome2024-ngff-challenge/0.0.5/6001240.zarr`,
} as const;

const skip =
  process.env.PARFOCAL_IDR === "1" ? false : "set PARFOCAL_IDR=1 to read the public IDR samples";

interface Reading {
  readonly shape: readonly (readonly number[])[];
  readonly channels: readonly string[];
  readonly sums: readonly number[];
  readonly distinct: number;
  readonly requests: number;
}

async function read(url: string): Promise<Reading> {
  let requests = 0;
  const source: PixelSource = await openOmeZarrSource({
    formatId: "ome-zarr",
    url,
    fetch: (input, init) => {
      requests++;
      return fetch(input, init);
    },
  });
  const sums: number[] = [];
  const seen = new Set<number>();
  for (const level of [0, source.levels.length - 1]) {
    const tile = await source.getTile({ level, x: 0, y: 0 });
    assert.equal(tile.absent, false);
    if (tile.absent) continue;
    assert.equal(tile.planes.length, 2);
    for (const plane of tile.planes) {
      assert.ok(plane instanceof Uint16Array);
      let sum = 0;
      for (const value of plane) {
        sum += value;
        seen.add(value);
      }
      sums.push(sum);
    }
  }
  const reading = {
    shape: source.levels.map(({ width, height, tileWidth, tileHeight, downsample }) => [
      width,
      height,
      tileWidth,
      tileHeight,
      downsample,
    ]),
    channels: source.channels.map((channel) => channel.name),
    sums,
    distinct: seen.size,
    requests,
  };
  assert.equal(source.photometric, "channels");
  assert.equal(source.dtype, "uint16");
  assert.ok(Math.abs((source.micronsPerPixel?.x ?? 0) - 0.3604) < 1e-4);
  source.close();
  return reading;
}

describe("public IDR samples of image 6001240", () => {
  it("reads the same pixels from the 0.4 store and the sharded 0.5 store", { skip }, async () => {
    const [plain, sharded] = await Promise.all(Object.values(samples).map(read));
    assert.ok(plain !== undefined && sharded !== undefined);
    console.log(JSON.stringify({ plain, sharded }));
    assert.deepEqual(plain.shape, [
      [271, 275, 271, 275, 1],
      [135, 137, 135, 137, 2],
      [67, 68, 67, 68, 4],
    ]);
    assert.deepEqual(sharded.shape, plain.shape);
    assert.deepEqual(plain.channels, ["LaminB1", "Dapi"]);
    assert.deepEqual(sharded.channels, plain.channels);
    assert.deepEqual(sharded.sums, plain.sums);
    assert.ok(plain.distinct > 16);
  });
});
