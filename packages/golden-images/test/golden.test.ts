import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { contentProblems, EmptyFrameError } from "#content.ts";
import { createFrame, flipRows, swapRedAndBlue } from "#frame.ts";
import { checkGolden, goldenPath, UPDATE_COMMAND } from "#golden.ts";
import { decodePng, encodePng } from "#png.ts";
import { syntheticHeTile } from "#synthetic-tile.ts";

const workspace = mkdtempSync(join(tmpdir(), "golden-images-"));
after(() => rmSync(workspace, { recursive: true, force: true }));

const tile = syntheticHeTile(64);

function uniform(rgba: readonly number[]) {
  const frame = createFrame(64, 64);
  for (let offset = 0; offset < frame.data.length; offset += 4) {
    frame.data.set(rgba, offset);
  }
  return frame;
}

test("the synthetic tile is deterministic and has content", () => {
  assert.deepEqual(syntheticHeTile(64).data, tile.data);
  assert.deepEqual(contentProblems(syntheticHeTile(256)), []);
});

test("cleared, uniform and transparent frames are reported as empty", () => {
  assert.ok(contentProblems(uniform([242, 242, 242, 255])).length > 0);
  assert.ok(contentProblems(uniform([0, 0, 0, 0])).includes("every pixel is transparent"));
  const almostUniform = uniform([242, 242, 242, 255]);
  almostUniform.data.set([10, 10, 10, 255], 0);
  assert.ok(contentProblems(almostUniform).length > 0);
});

test("PNG encoding round-trips RGBA bytes", () => {
  const decoded = decodePng(encodePng(tile));
  assert.equal(decoded.width, 64);
  assert.deepEqual(decoded.data, tile.data);
});

test("flipping rows twice gives the original frame", () => {
  assert.deepEqual(flipRows(flipRows(tile)).data, tile.data);
  assert.notDeepEqual(flipRows(tile).data, tile.data);
});

test("a missing golden fails and names the update command", () => {
  assert.throws(
    () =>
      checkGolden(tile, {
        name: "missing",
        format: "synthetic",
        goldenDirectory: join(workspace, "none"),
        outputDirectory: workspace,
        update: false,
      }),
    (error: unknown) => error instanceof Error && error.message.includes(UPDATE_COMMAND),
  );
});

test("update mode writes a golden that then matches", () => {
  const check = {
    name: "tile",
    format: "synthetic" as const,
    goldenDirectory: join(workspace, "goldens"),
    outputDirectory: join(workspace, "out"),
  };
  assert.equal(checkGolden(tile, { ...check, update: true }).status, "written");
  assert.ok(existsSync(goldenPath(check.goldenDirectory, "tile")));
  assert.equal(checkGolden(tile, { ...check, update: false }).status, "matched");
});

test("a mismatch writes the actual and diff images and explains the failure", () => {
  const check = {
    name: "swapped",
    format: "svs-jpeg" as const,
    goldenDirectory: join(workspace, "goldens"),
    outputDirectory: join(workspace, "out"),
  };
  checkGolden(tile, { ...check, update: true });
  const outcome = checkGolden(swapRedAndBlue(tile), { ...check, update: false });
  assert.equal(outcome.status, "mismatched");
  if (outcome.status === "mismatched") {
    assert.match(outcome.message, /BGR order/);
    assert.ok(existsSync(join(check.outputDirectory, "swapped.actual.png")));
    assert.ok(existsSync(join(check.outputDirectory, "swapped.diff.png")));
  }
});

test("an empty frame is never written as a golden", () => {
  assert.throws(
    () =>
      checkGolden(uniform([242, 242, 242, 255]), {
        name: "empty",
        format: "synthetic",
        goldenDirectory: join(workspace, "goldens"),
        outputDirectory: workspace,
        update: true,
      }),
    EmptyFrameError,
  );
  assert.equal(existsSync(goldenPath(join(workspace, "goldens"), "empty")), false);
});
