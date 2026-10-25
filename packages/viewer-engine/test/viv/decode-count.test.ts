import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { openTiffSource, type PixelSource } from "../../src/index.ts";
import { createVivLevels } from "../../src/viv/index.ts";
import { syntheticDir } from "../pixel-source/fixtures.ts";
import { serve } from "../pixel-source/serve.ts";

const served = await serve({ "/synthetic": syntheticDir });

after(async () => {
  await served.close();
});

function counted(source: PixelSource): { source: PixelSource; reads: Map<string, number> } {
  const reads = new Map<string, number>();
  const note = (key: string) => reads.set(key, (reads.get(key) ?? 0) + 1);
  return {
    reads,
    source: {
      ...source,
      getTile: (request) => {
        note(`tile ${request.level}/${request.x},${request.y}`);
        return source.getTile(request);
      },
      getRaster: (request) => {
        note(`raster ${request.level}/${request.window?.join(",") ?? "all"}`);
        return source.getRaster(request);
      },
    },
  };
}

describe("one decode per tile for a three channel slide", () => {
  it("gives Viv one interleaved RGB tile per request, so three channels cost one read", async () => {
    const opened = await openTiffSource({
      formatId: "generic-tiff",
      url: served.url("/synthetic/synthetic-jpeg.tiff"),
    });
    const { source, reads } = counted(opened);
    const { levels, tileSize } = createVivLevels(source);
    const [base] = levels;
    assert.ok(base);
    assert.deepEqual(base.shape.slice(2), [3], "the three channels are one interleaved array");
    const columns = Math.ceil((base.shape[1] ?? 0) / tileSize);
    const rows = Math.ceil((base.shape[0] ?? 0) / tileSize);
    const tiles = await Promise.all(
      Array.from({ length: columns * rows }, (_, at) =>
        base.getTile({ x: at % columns, y: Math.floor(at / columns) }),
      ),
    );
    for (const tile of tiles) assert.equal(tile.data.length, tile.width * tile.height * 3);
    assert.equal(reads.size, columns * rows);
    assert.equal(Math.max(...reads.values()), 1);
    assert.equal(
      [...reads.values()].reduce((sum, count) => sum + count, 0),
      columns * rows,
      "twelve tiles, twelve reads",
    );
  });
});
