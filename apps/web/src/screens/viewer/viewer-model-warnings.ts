import type { ResultSetTyper, ReviewObject } from "@parfocal/api-client";
import { BAND_CUTOFFS } from "@parfocal/ui/lib/confidence-words";
import {
  type ModelWarning,
  modelWarnings,
  slideStatistics,
  type TyperMetadata,
} from "@parfocal/ui/lib/model-warnings";

export function typerMetadata(typer: ResultSetTyper): TyperMetadata {
  return {
    name: typer.name,
    calibrated: typer.calibrated,
    validatedSites: typer.validated_sites,
    ...(typer.test_set_accuracy !== null ? { testSetAccuracy: typer.test_set_accuracy } : {}),
    ...(typer.test_set_confident_share !== null
      ? { testSetConfidentShare: typer.test_set_confident_share }
      : {}),
    ...(typer.test_set_unsure_share !== null
      ? { testSetUnsureShare: typer.test_set_unsure_share }
      : {}),
  };
}

export function viewerModelWarnings(
  typer: ResultSetTyper | undefined,
  objects: readonly ReviewObject[],
  enabled: boolean,
): ModelWarning[] {
  if (!enabled || typer === undefined) return [];
  const calls = objects
    .filter((object) => object.kind === "cell")
    .map((object) => [{ label: object.class_name, probability: object.score }]);
  return modelWarnings(typerMetadata(typer), slideStatistics(calls, BAND_CUTOFFS));
}
