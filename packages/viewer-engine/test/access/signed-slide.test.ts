import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  CrossOriginSlideBytesError,
  createSlideAccess,
  LevelTableError,
  parseLevelTable,
  SlideBytesError,
  signedOpenRequest,
  slideFormatFromName,
  slideIndexFromLevelTable,
} from "../../src/access/signed-slide.ts";
import { type Fetcher, TileAccess } from "../../src/access/tile-access.ts";
import { UnsupportedFormatError } from "../../src/pixel-source/types.ts";

const TABLE = {
  reader: "openslide",
  levels: [
    {
      index: 0,
      downsample: 1,
      width: 46_000,
      height: 32_914,
      stored: { width: 46_000, height: 32_914, tile_width: 256 },
    },
    {
      index: 1,
      downsample: 4,
      width: 11_500,
      height: 8_228,
      stored: { width: 11_500, height: 8_228, tile_width: 256 },
    },
  ],
  scale: { mpp_x: 0.499, mpp_y: 0.499, objective_power: 20 },
  planes: 1,
  notices: [],
};

function access(): TileAccess {
  return new TileAccess(() => Promise.resolve({ token: "signed-token", lifetimeSeconds: 600 }));
}

function tableFetcher(seen: { url: string; authorization: string | null }[]): Fetcher {
  return (input, init) => {
    seen.push({ url: input, authorization: new Headers(init.headers).get("authorization") });
    return Promise.resolve(Response.json(TABLE));
  };
}

describe("parseLevelTable", () => {
  test("reads levels, stored sizes and the pixel size", () => {
    const table = parseLevelTable(TABLE);
    assert.equal(table.levels.length, 2);
    assert.deepEqual(table.levels[1]?.stored, { width: 11_500, height: 8_228 });
    assert.deepEqual(table.micronsPerPixel, { x: 0.499, y: 0.499 });
  });

  test("keeps the pixel size unknown when the scale is missing", () => {
    const table = parseLevelTable({ ...TABLE, scale: { mpp_x: null, mpp_y: null } });
    assert.equal(table.micronsPerPixel, null);
    assert.equal(parseLevelTable({ levels: TABLE.levels }).micronsPerPixel, null);
  });

  test("refuses a table without levels or with a bad size", () => {
    assert.throws(() => parseLevelTable({ levels: [] }), LevelTableError);
    assert.throws(() => parseLevelTable("nothing"), LevelTableError);
    const broken = { levels: [{ ...TABLE.levels[0], width: 0 }] };
    assert.throws(() => parseLevelTable(broken), LevelTableError);
    const unstored = { levels: [{ downsample: 1, width: 5, height: 5 }] };
    assert.throws(() => parseLevelTable(unstored), LevelTableError);
  });
});

describe("slideIndexFromLevelTable", () => {
  test("names every level by its stored size and carries the format and pixel size", () => {
    const index = slideIndexFromLevelTable(parseLevelTable(TABLE), "leica-scn");
    assert.equal(index.formatId, "leica-scn");
    assert.deepEqual(index.levels?.[0], {
      stored: { width: 46_000, height: 32_914 },
      downsample: 1,
      width: 46_000,
      height: 32_914,
    });
    assert.deepEqual(index.micronsPerPixel, { x: 0.499, y: 0.499 });
  });
});

describe("slideFormatFromName", () => {
  test("picks the format from the extension, case-insensitively", () => {
    assert.equal(slideFormatFromName("CMU-1.SVS"), "aperio-svs");
    assert.equal(slideFormatFromName("slide.scn"), "leica-scn");
    assert.equal(slideFormatFromName("slide.ome.tiff"), "ome-tiff");
    assert.equal(slideFormatFromName("slide.tif"), "generic-tiff");
    assert.equal(slideFormatFromName("slide.ndpi"), "hamamatsu-ndpi");
    assert.equal(slideFormatFromName("slide.unknown"), null);
  });
});

describe("signedOpenRequest", () => {
  test("reads levels.json with the token and builds a request whose fetch carries it", async () => {
    const seen: { url: string; authorization: string | null }[] = [];
    const request = await signedOpenRequest({
      access: access(),
      basePath: "/tiles/slide-1/",
      baseUrl: "https://app.test/projects/p/slides/slide-1",
      original: "CMU 1.svs",
      fetcher: tableFetcher(seen),
    });
    assert.deepEqual(seen, [
      { url: "https://app.test/tiles/slide-1/levels.json", authorization: "Bearer signed-token" },
    ]);
    assert.equal(request.formatId, "aperio-svs");
    assert.equal(request.url, "https://app.test/tiles/slide-1/CMU%201.svs");
    assert.equal(request.index?.levels?.length, 2);
  });

  test("adds the slash a base path lacks", async () => {
    const seen: { url: string; authorization: string | null }[] = [];
    const request = await signedOpenRequest({
      access: access(),
      basePath: "/tiles/slide-1",
      baseUrl: "https://app.test/",
      original: "a.svs",
      fetcher: tableFetcher(seen),
    });
    assert.equal(seen[0]?.url, "https://app.test/tiles/slide-1/levels.json");
    assert.equal(request.url, "https://app.test/tiles/slide-1/a.svs");
  });

  test("sends the token on every later byte read", async () => {
    const seen: { url: string; authorization: string | null }[] = [];
    const fetcher = tableFetcher(seen);
    const request = await signedOpenRequest({
      access: access(),
      basePath: "/tiles/s/",
      baseUrl: "https://app.test/",
      original: "a.svs",
      fetcher,
    });
    await request.fetch?.("https://app.test/tiles/s/a.svs", {
      headers: { range: "bytes=0-9" },
    });
    assert.equal(seen.length, 2);
    assert.equal(seen[1]?.authorization, "Bearer signed-token");
  });

  test("reports the status when the level table is refused", async () => {
    const refused: Fetcher = () => Promise.resolve(new Response("no", { status: 403 }));
    await assert.rejects(
      signedOpenRequest({
        access: access(),
        basePath: "/tiles/s/",
        baseUrl: "https://app.test/",
        original: "a.svs",
        fetcher: refused,
      }),
      (error: unknown) => error instanceof SlideBytesError && error.status === 403,
    );
  });

  test("refuses an original whose format is unknown before asking for anything", async () => {
    const seen: { url: string; authorization: string | null }[] = [];
    await assert.rejects(
      signedOpenRequest({
        access: access(),
        basePath: "/tiles/s/",
        baseUrl: "https://app.test/",
        original: "a.xyz",
        fetcher: tableFetcher(seen),
      }),
      UnsupportedFormatError,
    );
    assert.equal(seen.length, 0);
  });

  test("never sends the token to an origin other than the app's", async () => {
    const seen: { url: string; authorization: string | null }[] = [];
    await assert.rejects(
      signedOpenRequest({
        access: access(),
        basePath: "https://tiles.elsewhere.test/tiles/s/",
        baseUrl: "https://app.test/projects/p/slides/s",
        original: "a.svs",
        fetcher: tableFetcher(seen),
      }),
      (error: unknown) =>
        error instanceof CrossOriginSlideBytesError &&
        error.url === "https://tiles.elsewhere.test/tiles/s/",
    );
    assert.equal(seen.length, 0);
  });

  test("accepts an absolute base path on the app origin", async () => {
    const seen: { url: string; authorization: string | null }[] = [];
    await signedOpenRequest({
      access: access(),
      basePath: "https://app.test/tiles/s/",
      baseUrl: "https://app.test/projects/p/slides/s",
      original: "a.svs",
      fetcher: tableFetcher(seen),
    });
    assert.equal(seen[0]?.url, "https://app.test/tiles/s/levels.json");
  });

  test("lets the caller name the format", async () => {
    const request = await signedOpenRequest({
      access: access(),
      basePath: "/tiles/s/",
      baseUrl: "https://app.test/",
      original: "a.xyz",
      formatId: "generic-tiff",
      fetcher: tableFetcher([]),
    });
    assert.equal(request.formatId, "generic-tiff");
  });
});

describe("createSlideAccess", () => {
  test("mints once, hands back the grant and passes the old token on renewal", async () => {
    const previous: (string | null)[] = [];
    let clock = 0;
    const slide = createSlideAccess(
      (old) => {
        previous.push(old);
        return Promise.resolve({
          token: `token-${previous.length}`,
          lifetimeSeconds: 600,
          basePath: "/tiles/s/",
          original: "a.svs",
        });
      },
      () => clock,
    );
    assert.equal((await slide.grant()).basePath, "/tiles/s/");
    assert.equal((await slide.grant()).original, "a.svs");
    assert.deepEqual(previous, [null]);
    clock = 400_000;
    assert.equal(await slide.access.token(), "token-1");
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(previous, [null, "token-1"]);
  });
});
