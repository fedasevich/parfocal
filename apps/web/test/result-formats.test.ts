import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  resultAccept,
  resultFileKindOf,
  resultSuffixes,
  suffixOf,
} from "../src/screens/upload/result-formats.ts";

const python = readFileSync(
  new URL("../../../packages/py-common/src/parfocal_common/result_imports.py", import.meta.url),
  "utf8",
);

const blockOf = (name: string) => {
  const found = new RegExp(`^${name}[^=]*=\\s*([^\\n]*(?:\\n(?!\\S)[^\\n]*)*)`, "m").exec(python);
  assert.ok(found, `${name} is in result_imports.py`);
  return found[1] ?? "";
};

const suffixesIn = (block: string) => [...block.matchAll(/"(\.[a-z]+)"/g)].map((match) => match[1]);

test("the viewer accepts exactly the result suffixes the server imports", () => {
  const server = new Set([
    ...suffixesIn(blockOf("FORMAT_SUFFIXES")),
    ...suffixesIn(blockOf("SNIFFED_SUFFIXES")),
  ]);
  assert.ok(server.size >= 7);
  assert.deepEqual(new Set(resultSuffixes), server);
  assert.equal(resultAccept, resultSuffixes.join(","));
});

test("each result suffix has a preview kind and other files have none", () => {
  assert.equal(resultFileKindOf("model.GeoJSON"), "shapes");
  assert.equal(resultFileKindOf("cells.tsv"), "table");
  assert.equal(resultFileKindOf("heat.png"), "image");
  assert.equal(resultFileKindOf("mask.tiff"), "raster");
  assert.equal(resultFileKindOf("cells.parquet"), null);
  assert.equal(resultFileKindOf("slide.svs"), null);
  assert.equal(suffixOf("folder.v2/README"), "");
  assert.equal(suffixOf(".csv"), "");
});
