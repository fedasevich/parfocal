import assert from "node:assert/strict";
import { test } from "node:test";
import { asciiObjectId, copyObjectId, objectIdPath } from "../src/lib/object-id.ts";

test("the on-screen separators and person mark become their ASCII forms", () => {
  assert.equal(asciiObjectId("T2·C145"), "T2.C145");
  assert.equal(asciiObjectId("T6⁺"), "T6+");
  assert.equal(asciiObjectId("C3021"), "C3021");
});

test("the full path is project, case, slide and object", () => {
  assert.equal(
    objectIdPath({ project: "P07", caseLabel: "S26-04812", slide: "A1", object: "T2·C145" }),
    "P07/S26-04812/A1/T2.C145",
  );
});

test("a loose slide has a tilde for its case and each segment is percent-encoded", () => {
  assert.equal(
    objectIdPath({ project: "P07", caseLabel: null, slide: "tcga-0042", object: "T2" }),
    "P07/~/tcga-0042/T2",
  );
  assert.equal(
    objectIdPath({ project: "P07", caseLabel: "A/B 1", slide: "A1", object: "T6⁺" }),
    "P07/A%2FB%201/A1/T6+",
  );
});

test("copying writes the text and says whether it worked", async () => {
  const written: string[] = [];
  const clipboard = {
    writeText: (text: string) => {
      written.push(text);
      return Promise.resolve();
    },
  };
  assert.equal(await copyObjectId("P07/~/A1/T2", clipboard), true);
  assert.deepEqual(written, ["P07/~/A1/T2"]);
  assert.equal(await copyObjectId("x", undefined), false);
  const refused = {
    writeText: () => Promise.reject(new Error("denied")),
  };
  assert.equal(await copyObjectId("x", refused), false);
});
