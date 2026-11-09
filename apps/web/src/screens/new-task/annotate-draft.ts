import type { CheckChange, CheckPart, CheckPreset } from "@parfocal/api-client";
import type { AnnotateCheck, AnnotatePresetKey } from "./model.ts";

export const checkPresetOf: Record<AnnotatePresetKey, CheckPreset> = {
  hand: "annotate-by-hand",
  run: "check-whole-slide-run",
  sample: "check-sample",
  regions: "fix-ai-on-selected-areas",
  mixed: "mixed",
};

const partsOf = ({ scope, sampleSize }: AnnotateCheck): CheckPart[] => {
  if (scope === "all") return [{ kind: "all-objects" }];
  if (scope === "sample") return [{ kind: "random-cells", count: sampleSize }];
  if (scope === "regions") return [{ kind: "inside-rois" }];
  return [];
};

export function checkChangeOf(
  check: AnnotateCheck,
  fromPreset: AnnotateCheck,
): CheckChange | undefined {
  const change: CheckChange = {};
  const sampleChanged = check.scope === "sample" && check.sampleSize !== fromPreset.sampleSize;
  if (check.scope !== fromPreset.scope || sampleChanged) change.scope = partsOf(check);
  if (check.order !== fromPreset.order) {
    change.order = check.order === "least-sure" ? "least-sure-first" : "position";
  }
  if (check.rule !== fromPreset.rule) {
    change.sign_off = check.rule === "require" ? "all-checked" : "warn";
  }
  if (check.exportUnchecked !== fromPreset.exportUnchecked) {
    change.unchecked_export = check.exportUnchecked ? "include" : "leave-out";
  }
  return Object.keys(change).length ? change : undefined;
}
