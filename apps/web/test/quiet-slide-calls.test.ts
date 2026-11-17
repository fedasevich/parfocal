import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { formatNameOf } from "../src/screens/format-name.ts";
import { storedTissue } from "../src/viewer/slide-coverage.ts";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

function answerWith(status: number, calls: string[]) {
  globalThis.fetch = (input) => {
    calls.push(input instanceof Request ? input.url : input.toString());
    const body = JSON.stringify({ status, code: "tissue-mask-missing", title: "none" });
    return Promise.resolve(
      new Response(body, { status, headers: { "content-type": "application/problem+json" } }),
    );
  };
}

test("the format name is the upper-cased file extension", () => {
  assert.equal(formatNameOf("tumor_044.svs"), "SVS");
  assert.equal(formatNameOf("scan.ome.tiff"), "TIFF");
  assert.equal(formatNameOf("noextension"), "");
  assert.equal(formatNameOf(".hidden"), "");
});

test("a 404 tissue answer is remembered and not asked again", async () => {
  const calls: string[] = [];
  answerWith(404, calls);
  assert.equal(await storedTissue("slide-without-mask"), null);
  assert.equal(await storedTissue("slide-without-mask"), null);
  assert.equal(calls.length, 1);
});

test("a 200 answer with no mask is remembered and not asked again", async () => {
  const calls: string[] = [];
  globalThis.fetch = (input) => {
    calls.push(input instanceof Request ? input.url : input.toString());
    const grid = { cell: 64, columns: 2, rows: 2 };
    const body = JSON.stringify({ slide_id: "s", grid, tissue: null, tissue_cells: 0 });
    return Promise.resolve(
      new Response(body, { status: 200, headers: { "content-type": "application/json" } }),
    );
  };
  assert.equal(await storedTissue("slide-with-null-mask"), null);
  assert.equal(await storedTissue("slide-with-null-mask"), null);
  assert.equal(calls.length, 1);
});

test("a server error is not remembered", async () => {
  const calls: string[] = [];
  answerWith(500, calls);
  assert.equal(await storedTissue("slide-with-trouble"), null);
  assert.equal(await storedTissue("slide-with-trouble"), null);
  assert.equal(calls.length, 2);
});
