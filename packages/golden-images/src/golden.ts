import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  type Comparison,
  compareFrames,
  describeComparison,
  diffFrame,
  type Tolerance,
} from "#compare.ts";
import { assertFrameHasContent, type ContentMinimums, DEFAULT_CONTENT_MINIMUMS } from "#content.ts";
import type { Frame } from "#frame.ts";
import { readPng, writePng } from "#png.ts";
import { type SlideFormat, toleranceFor } from "#tolerances.ts";

export interface GoldenCheck {
  readonly name: string;
  readonly format: SlideFormat;
  readonly goldenDirectory: string;
  readonly outputDirectory: string;
  readonly tolerance?: Tolerance;
  readonly content?: ContentMinimums;
  readonly update?: boolean;
}

export type GoldenOutcome =
  | { readonly status: "matched"; readonly comparison: Comparison }
  | { readonly status: "written"; readonly path: string }
  | { readonly status: "mismatched"; readonly comparison: Comparison; readonly message: string };

export const UPDATE_COMMAND = "pnpm --filter @parfocal/golden-images golden:update";

export function goldenUpdateRequested(): boolean {
  return process.env.GOLDEN_UPDATE === "1";
}

export function goldenPath(directory: string, name: string): string {
  return join(directory, `${name}.png`);
}

export function checkGolden(frame: Frame, check: GoldenCheck): GoldenOutcome {
  assertFrameHasContent(frame, check.content ?? DEFAULT_CONTENT_MINIMUMS);
  const path = goldenPath(check.goldenDirectory, check.name);
  if (check.update ?? goldenUpdateRequested()) {
    writePng(path, frame);
    return { status: "written", path };
  }
  if (!existsSync(path)) {
    throw new Error(`No golden image at ${path}. Run ${UPDATE_COMMAND} and review the new file`);
  }
  const golden = readPng(path);
  const tolerance = check.tolerance ?? toleranceFor(check.format);
  const comparison = compareFrames(frame, golden, tolerance);
  if (comparison.pass) {
    return { status: "matched", comparison };
  }
  const actualPath = join(check.outputDirectory, `${check.name}.actual.png`);
  const diffPath = join(check.outputDirectory, `${check.name}.diff.png`);
  writePng(actualPath, frame);
  writePng(diffPath, diffFrame(frame, golden, tolerance));
  return {
    status: "mismatched",
    comparison,
    message: `${check.name} (${check.format}) does not match ${path}\n${describeComparison(comparison)}\nActual: ${actualPath}\nDiff: ${diffPath}\nIf the change is intended, run ${UPDATE_COMMAND} and review the new golden`,
  };
}
