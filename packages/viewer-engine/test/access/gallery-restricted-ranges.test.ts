import assert from "node:assert/strict";
import { type FileHandle, open, readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { cachedFixture, skipUnlessCached } from "@parfocal/test-fixtures";
import { signedOpenRequest } from "../../src/access/signed-slide.ts";
import { TileAccess } from "../../src/access/tile-access.ts";
import { cachedFetch } from "../../src/decode/byte-relay.ts";
import { rangeCacheFor } from "../../src/decode/range-cache.ts";
import { openTiffSource } from "../../src/pixel-source/index.ts";
import type { SlideFormatId } from "../../src/pixel-source/types.ts";

type ByteRange = readonly [number, number];

interface GalleryTable {
  readonly levels: unknown;
  readonly restricted: readonly ByteRange[];
}

const tables = JSON.parse(
  await readFile(new URL("./gallery-level-tables.json", import.meta.url), "utf8"),
) as Record<string, GalleryTable>;

const slides: readonly (readonly [string, SlideFormatId])[] = [
  ["CMU-1-Small-Region.svs", "aperio-svs"],
  ["Philips-4.tiff", "philips-tiff"],
  ["CMU-1.ndpi", "hamamatsu-ndpi"],
];

interface Asked {
  readonly range: string;
  readonly status: number;
}

function edgeOf(file: FileHandle, size: number, table: GalleryTable, asked: Asked[]) {
  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
    if (url.endsWith("levels.json")) return new Response(JSON.stringify(table.levels));
    const range = new Headers(init?.headers).get("Range") ?? "";
    const [start = 0, last = 0] = range.replace("bytes=", "").split("-").map(Number);
    const end = Math.min(last + 1, size);
    const refused = table.restricted.some(([from, to]) => start < to && from < end);
    asked.push({ range, status: refused ? 403 : 206 });
    if (refused) return new Response(null, { status: 403 });
    const bytes = Buffer.alloc(end - start);
    await file.read(bytes, 0, bytes.length, start);
    return new Response(bytes, {
      status: 206,
      headers: { "Content-Range": `bytes ${start}-${end - 1}/${size}` },
    });
  };
}

for (const [name, formatId] of slides) {
  const table = tables[name];
  describe(`the gallery's ${name} behind the edge's label and macro ranges`, {
    skip: skipUnlessCached(name),
  }, () => {
    it("opens and draws a tile without one refused request", async () => {
      assert.ok(table !== undefined);
      const file = await open(cachedFixture(name) ?? "");
      const asked: Asked[] = [];
      try {
        const edge = edgeOf(file, (await file.stat()).size, table, asked);
        const token = capabilityLike(name, table.restricted);
        const access = new TileAccess(() => Promise.resolve({ token, lifetimeSeconds: 600 }));
        const request = await signedOpenRequest({
          access,
          basePath: "/tiles/gallery/",
          original: name,
          baseUrl: "https://app.example",
          formatId,
          fetcher: edge,
        });
        assert.deepEqual(request.restricted, table.restricted);
        const bytes = rangeCacheFor(request);
        const source = await openTiffSource({
          ...request,
          fetch: cachedFetch(bytes),
          nativeJpeg: "off",
        });
        await source.getTile({ level: source.levels.length - 1, x: 0, y: 0 });
        source.close();
        assert.deepEqual(
          asked.filter(({ status }) => status === 403),
          [],
        );
      } finally {
        await file.close();
      }
    });
  });
}

function capabilityLike(original: string, restricted: readonly ByteRange[]): string {
  const claims = { d: restricted, o: original, v: 1 };
  return `${Buffer.from(JSON.stringify(claims)).toString("base64url")}.signature`;
}
