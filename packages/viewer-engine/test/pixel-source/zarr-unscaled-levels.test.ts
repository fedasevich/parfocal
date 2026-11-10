import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { openOmeZarrSource } from "../../src/index.ts";
import { virtualLadder, vivTileSize } from "../../src/viv/index.ts";
import { serve } from "./serve.ts";
import { writeZarrFixture } from "./zarr-fixture.ts";

const common = { version: 2, dtype: "uint8", channels: 3, chunk: 256, levels: 3 } as const;
const odd = await writeZarrFixture({ ...common, width: 1001, height: 601, scales: false });
const scaled = await writeZarrFixture({ ...common, width: 1001, height: 601 });
const swapped = await writeZarrFixture({ ...common, width: 512, height: 256, axisOrder: "xy" });
const served = await serve({ "/odd": odd.root, "/scaled": scaled.root, "/swapped": swapped.root });

after(async () => {
  await served.close();
  await odd.remove();
  await scaled.remove();
  await swapped.remove();
});

const open = (mount: string) => openOmeZarrSource({ formatId: "ome-zarr", url: served.url(mount) });

describe("OME-Zarr levels with no declared scale", () => {
  it("snaps the downsample of a level whose size was rounded to a power of two", async () => {
    const source = await open("/odd");
    assert.deepEqual(
      source.levels.map((level) => [level.width, level.downsample]),
      [
        [1001, 1],
        [501, 2],
        [251, 4],
      ],
    );
    const ladder = virtualLadder(source.levels, vivTileSize(source));
    assert.deepEqual(
      ladder.map((level) => [level.downsample, level.backing, level.residual]),
      [
        [1, 0, 1],
        [2, 1, 1],
        [4, 2, 1],
      ],
    );
    source.close();
  });

  it("gives the same levels as a store that declares its scales", async () => {
    const [plain, declared] = await Promise.all([open("/odd"), open("/scaled")]);
    const shape = (source: typeof plain) =>
      source.levels.map(({ width, height, downsample }) => ({ width, height, downsample }));
    assert.deepEqual(shape(plain), shape(declared));
    plain.close();
    declared.close();
  });

  it("refuses a store whose x axis comes before y", async () => {
    await assert.rejects(open("/swapped"), /y before x/);
  });
});
