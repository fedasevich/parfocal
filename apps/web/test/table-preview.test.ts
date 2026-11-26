import assert from "node:assert/strict";
import { test } from "node:test";
import {
  evenSample,
  previewOfText,
  previewShapeCap,
  readFilePreview,
} from "../src/results/file-preview.ts";
import { parseResults } from "../src/results/geojson-placement.ts";
import {
  delimiterOf,
  splitRow,
  tableColumnsOf,
  tablePreview,
} from "../src/results/table-preview.ts";

test("the delimiter is the one the header splits on most", () => {
  assert.equal(delimiterOf("x,y,class"), ",");
  assert.equal(delimiterOf("x\ty\tclass"), "\t");
  assert.equal(delimiterOf("x;y;class"), ";");
  assert.equal(delimiterOf('"name, long";x;y'), ";");
  assert.equal(delimiterOf("x"), ",");
});

test("quoted cells keep their delimiters and doubled quotes", () => {
  assert.deepEqual(splitRow('1,"a, b","say ""hi""",2', ","), ["1", "a, b", 'say "hi"', "2"]);
});

test("the x and y columns are found by the names the import guesses", () => {
  assert.deepEqual(tableColumnsOf("id,Centroid X µm,Centroid Y µm"), {
    delimiter: ",",
    x: 1,
    y: 2,
  });
  assert.deepEqual(tableColumnsOf("class\tcx\tcy"), { delimiter: "\t", x: 1, y: 2 });
  assert.equal(tableColumnsOf("class,score"), null);
});

test("a CSV of cells becomes points and skips rows without numbers", () => {
  const text = "﻿x,y,class\r\n10,20,Tumor\r\n,5,Stroma\r\n30.5,40,Tumor\r\n\r\nabc,1,Tumor\n";
  const results = tablePreview(text);
  assert.ok(results);
  assert.equal(results.objects, 2);
  assert.deepEqual(results.shapes, [
    { id: 0, kind: "point", x: 10, y: 20 },
    { id: 1, kind: "point", x: 30.5, y: 40 },
  ]);
  assert.equal(tablePreview("x,y\n"), null);
  assert.equal(tablePreview("a,b\n1,2"), null);
});

test("a Parfocal JSON file is read through its objects", () => {
  const text = JSON.stringify({
    format: "parfocal-results",
    version: 1,
    objects: [
      {
        kind: "region",
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [0, 0],
              [10, 0],
              [10, 10],
              [0, 0],
            ],
          ],
        },
      },
      { kind: "cell", geometry: { type: "Point", coordinates: [5, 5] } },
    ],
  });
  const results = parseResults(text);
  assert.equal(results?.objects, 2);
  assert.deepEqual(
    results?.shapes.map((shape) => shape.kind),
    ["ring", "point"],
  );
  const preview = previewOfText("model.json", text);
  assert.equal(preview.kind, "shapes");
  assert.equal(preview.kind === "shapes" && preview.alignable, false);
});

test("only GeoJSON keeps its text for the alignment rewrite", () => {
  const geojson = JSON.stringify({ type: "Point", coordinates: [1, 2] });
  const shown = previewOfText("cells.geojson", geojson);
  assert.equal(shown.kind === "shapes" && shown.alignable, true);
  assert.equal(shown.kind === "shapes" && shown.text, geojson);
  const table = previewOfText("cells.csv", "x,y\n1,2");
  assert.equal(table.kind === "shapes" && table.text, null);
  assert.deepEqual(previewOfText("cells.csv", "a\n1"), { kind: "none", why: "unreadable" });
  assert.deepEqual(previewOfText("broken.json", "{"), { kind: "none", why: "unreadable" });
});

test("a large result is drawn as an even sample of the cap", () => {
  const rows = Array.from({ length: 12_000 }, (_, index) => `${index},${index}`);
  const preview = previewOfText("cells.csv", `x,y\n${rows.join("\n")}`);
  assert.ok(preview.kind === "shapes");
  assert.equal(preview.total, 12_000);
  assert.equal(preview.results.shapes.length, previewShapeCap);
  assert.equal(preview.results.objects, 12_000);
  const xs = preview.results.shapes.map((shape) => (shape.kind === "point" ? shape.x : -1));
  assert.equal(xs[0], 0);
  assert.ok((xs.at(-1) ?? 0) > 11_900);
  assert.equal(new Set(preview.results.shapes.map((shape) => shape.id)).size, previewShapeCap);
  const small = { shapes: [{ id: 0, kind: "point" as const, x: 1, y: 1 }], objects: 1 };
  assert.equal(evenSample(small), small);
});

test("TIFF, oversized and unknown files get no preview", async () => {
  assert.deepEqual(await readFilePreview(new File(["II*"], "mask.tif")), {
    kind: "none",
    why: "raster",
  });
  assert.deepEqual(await readFilePreview(new File(["x"], "cells.parquet")), {
    kind: "none",
    why: "unsupported",
  });
  const big = new File([new Uint8Array(20 * 1024 * 1024 + 1)], "cells.csv");
  assert.deepEqual(await readFilePreview(big), { kind: "none", why: "large" });
  const csv = await readFilePreview(new File(["x,y\n3,4"], "cells.csv"));
  assert.equal(csv.kind === "shapes" && csv.total, 1);
});
