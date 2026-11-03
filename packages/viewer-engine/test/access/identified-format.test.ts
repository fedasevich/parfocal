import assert from "node:assert/strict";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { identifiedSlideFormat, signedOpenRequest } from "../../src/access/signed-slide.ts";
import { type Fetcher, TileAccess } from "../../src/access/tile-access.ts";
import { createDefaultPixelSourceRegistry } from "../../src/index.ts";
import { UnsupportedFormatError } from "../../src/pixel-source/types.ts";
import { syntheticDir } from "../pixel-source/fixtures.ts";
import { serve } from "../pixel-source/serve.ts";

const misnamed = "slide.ndpi";
const served = await serve({ [`/tiles/s/${misnamed}`]: join(syntheticDir, "synthetic-jpeg.tiff") });
after(() => served.close());

const registry = createDefaultPixelSourceRegistry();

async function levelTable(): Promise<unknown> {
  const source = await registry.open({
    formatId: "generic-tiff",
    url: served.url(`/tiles/s/${misnamed}`),
  });
  try {
    return {
      levels: source.levels.map((level) => ({
        downsample: level.downsample,
        width: level.width,
        height: level.height,
        stored: { width: level.width, height: level.height },
      })),
    };
  } finally {
    source.close();
  }
}

const table = await levelTable();

const fetcher: Fetcher = (input, init) =>
  input.endsWith("/levels.json") ? Promise.resolve(Response.json(table)) : fetch(input, init);

function open(identifiedFormat: string | null) {
  return signedOpenRequest({
    access: new TileAccess(() => Promise.resolve({ token: "t", lifetimeSeconds: 600 })),
    basePath: "/tiles/s/",
    baseUrl: `${served.origin}/`,
    original: misnamed,
    identifiedFormat,
    fetcher,
  });
}

describe("the format ingest identified", () => {
  test("opens a slide whose stored name has the wrong extension", async () => {
    const request = await open("generic-tiff");
    assert.equal(request.formatId, "generic-tiff");
    const source = await registry.open(request);
    try {
      assert.equal(source.formatId, "generic-tiff");
      const tile = await source.getTile({ level: 0, x: 0, y: 0 });
      assert.equal(tile.absent, false);
      assert.ok(tile.width > 0 && tile.height > 0);
    } finally {
      source.close();
    }
  });

  test("without it the extension names a reader the slide does not fit", async () => {
    const request = await open(null);
    assert.equal(request.formatId, "hamamatsu-ndpi");
    await assert.rejects(registry.open(request), UnsupportedFormatError);
  });

  test("an unknown identified format falls back to the extension", () => {
    assert.equal(identifiedSlideFormat("aperio-svs"), "aperio-svs");
    assert.equal(identifiedSlideFormat("made-up"), null);
    assert.equal(identifiedSlideFormat(undefined), null);
  });
});
