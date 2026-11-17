import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mergedSlices, PrimedRangeSource } from "../../src/pixel-source/tiff/primed-tiff.ts";

const fileBytes = 1000;

function fakeFile(failing: ReadonlySet<string> = new Set()) {
  const asked: string[] = [];
  const fetcher = (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const range = new Headers(init?.headers).get("Range") ?? "";
    asked.push(range);
    if (failing.has(range)) return Promise.resolve(new Response(null, { status: 403 }));
    const [start = 0, end = 0] = range.replace("bytes=", "").split("-").map(Number);
    const last = Math.min(end, fileBytes - 1);
    const body = Uint8Array.from({ length: last - start + 1 }, (_, at) => (start + at) % 251);
    return Promise.resolve(
      new Response(body, {
        status: 206,
        headers: { "Content-Range": `bytes ${start}-${last}/${fileBytes}` },
      }),
    );
  };
  return { asked, fetcher };
}

function bytesOf(buffer: ArrayBuffer): number[] {
  return Array.from(new Uint8Array(buffer));
}

describe("PrimedRangeSource", () => {
  it("answers a slice inside a primed range without asking again", async () => {
    const file = fakeFile();
    const source = new PrimedRangeSource("/s.tif", file.fetcher, [{ offset: 100, length: 50 }]);
    const [slice] = await source.fetch([{ offset: 110, length: 10 }]);
    assert.deepEqual(
      bytesOf(slice ?? new ArrayBuffer(0)),
      [110, 111, 112, 113, 114, 115, 116, 117, 118, 119],
    );
    assert.deepEqual(file.asked, ["bytes=100-149"]);
  });

  it("answers a longer slice from a range that came back short at the end of the file", async () => {
    const file = fakeFile();
    const source = new PrimedRangeSource("/s.tif", file.fetcher, [{ offset: 900, length: 400 }]);
    const [slice] = await source.fetch([{ offset: 950, length: 300 }]);
    assert.equal(slice?.byteLength, 50);
    assert.deepEqual(file.asked, ["bytes=900-1299"]);
  });

  it("asks the network for a slice running past a range that is not at the end of the file", async () => {
    const file = fakeFile();
    const source = new PrimedRangeSource("/s.tif", file.fetcher, [{ offset: 100, length: 50 }]);
    const [slice] = await source.fetch([{ offset: 140, length: 20 }]);
    assert.equal(slice?.byteLength, 20);
    assert.deepEqual(file.asked, ["bytes=100-149", "bytes=140-159"]);
  });

  it("asks the network again when the primed read failed", async () => {
    const file = fakeFile(new Set(["bytes=100-149"]));
    const source = new PrimedRangeSource("/s.tif", file.fetcher, [{ offset: 100, length: 50 }]);
    const [slice] = await source.fetch([{ offset: 100, length: 8 }]);
    assert.equal(slice?.byteLength, 8);
    assert.deepEqual(file.asked, ["bytes=100-149", "bytes=100-107"]);
  });

  it("merges overlapping and touching ranges into one read", () => {
    assert.deepEqual(
      mergedSlices([
        { offset: 200, length: 10 },
        { offset: 0, length: 100 },
        { offset: 50, length: 100 },
        { offset: 150, length: 5 },
      ]),
      [
        { offset: 0, length: 155 },
        { offset: 200, length: 10 },
      ],
    );
  });
});
