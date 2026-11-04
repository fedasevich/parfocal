import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import { setupServer } from "msw/node";
import { fakeApiHandlers, resetFakeCoverage } from "../src/fake/index.ts";
import { getSlideCoverage, getSlideTissue, recordSlideCoverage } from "../src/index.ts";

const server = setupServer(...fakeApiHandlers("all"));
let patchedFetch: typeof fetch;

before(() => {
  server.listen({ onUnhandledFrame: "error" });
  patchedFetch = globalThis.fetch;
  globalThis.fetch = (input, init) =>
    patchedFetch(new URL(input instanceof Request ? input.url : input, "http://app.test"), init);
});

afterEach(() => resetFakeCoverage());

after(() => {
  globalThis.fetch = patchedFetch;
  server.close();
});

const grid = { cell: 64, columns: 16, rows: 8 };

test("a slide nobody has looked at has no fake coverage yet", async () => {
  await assert.rejects(getSlideCoverage("slide-a"), { status: 409 });
});

test("fake coverage batches add up and read back", async () => {
  const first = await recordSlideCoverage("slide-a", { grid, cells: [0, 1, 2] });
  assert.equal(first.status, 200);
  await recordSlideCoverage("slide-a", { grid, cells: [2, 3, 127] });
  const read = await getSlideCoverage("slide-a");
  assert.equal(read.status, 200);
  if (read.status !== 200) return;
  assert.deepEqual(read.data.grid, grid);
  assert.equal(read.data.seen_cells, 5);
  const bytes = Buffer.from(read.data.seen, "base64");
  assert.equal(bytes.length, 16);
  assert.equal(bytes[0], 0b1111);
  assert.equal(bytes[15], 0b10000000);
});

test("the fake tissue mask is the dev slide's stored mask on its coverage grid", async () => {
  const read = await getSlideTissue("slide-a");
  assert.equal(read.status, 200);
  if (read.status !== 200) return;
  assert.deepEqual(read.data.grid, { cell: 64, columns: 16, rows: 12 });
  assert.equal(read.data.tissue_cells, 104);
  const bytes = Buffer.from(read.data.tissue, "base64");
  assert.equal(bytes.length, 24);
  assert.equal(bytes[0], 0b1111);
  assert.equal(bytes[23], 0xff);
});
