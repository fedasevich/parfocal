import {
  BAND_CUTOFFS,
  type BandCutoffs,
  bandOf,
  shapeOf,
  type TypeCall,
} from "./confidence-words.ts";

export type TyperMetadata = {
  name: string;
  calibrated: boolean;
  testSetAccuracy?: number;
  testSetConfidentShare?: number;
  testSetUnsureShare?: number;
  validatedSites?: readonly string[];
  cutoffs?: BandCutoffs;
};

export type SlideStatistics = {
  typedCells: number;
  confidentShare: number;
  unsureShare: number;
  site?: string | undefined;
};

export type ModelWarningKind =
  | "low-accuracy"
  | "uncalibrated"
  | "out-of-distribution"
  | "many-unsure"
  | "site-not-validated";

export type ModelWarning = {
  kind: ModelWarningKind;
  text: string;
};

export const WARNING_RULES = {
  minimumAccuracy: 0.7,
  confidentRatio: 0.6,
  minimumReferenceConfident: 0.2,
  unsureExcess: 0.15,
  minimumTypedCells: 100,
} as const;

const percent = (share: number) => `${Math.round(share * 100)}%`;

const normalise = (site: string) => site.trim().toLowerCase();

export function slideStatistics(
  cells: readonly (readonly TypeCall[])[],
  cutoffs: BandCutoffs = BAND_CUTOFFS,
  site?: string,
): SlideStatistics {
  let confident = 0;
  let unsure = 0;
  let typed = 0;
  for (const calls of cells) {
    if (calls.length === 0) continue;
    typed += 1;
    const top = Math.max(...calls.map((call) => call.probability));
    if (bandOf(top, cutoffs) === "confident") confident += 1;
    const shape = shapeOf(calls, cutoffs);
    if (shape === "doubtful" || shape === "close") unsure += 1;
  }
  return {
    typedCells: typed,
    confidentShare: typed === 0 ? 0 : confident / typed,
    unsureShare: typed === 0 ? 0 : unsure / typed,
    site,
  };
}

export function modelWarnings(typer: TyperMetadata, slide?: SlideStatistics): ModelWarning[] {
  const warnings: ModelWarning[] = [];
  const accuracy = typer.testSetAccuracy;
  if (accuracy !== undefined && accuracy < WARNING_RULES.minimumAccuracy) {
    warnings.push({
      kind: "low-accuracy",
      text: `${typer.name} typed only ${percent(accuracy)} of cells right on its own test set.`,
    });
  }
  if (!typer.calibrated) {
    warnings.push({
      kind: "uncalibrated",
      text: `${typer.name} is not calibrated, so its percentages are not measured chances.`,
    });
  }
  if (!slide) return warnings;
  const validated = typer.validatedSites;
  if (validated && slide.site !== undefined) {
    const site = normalise(slide.site);
    if (!validated.some((entry) => normalise(entry) === site)) {
      warnings.push({
        kind: "site-not-validated",
        text: `${typer.name} was not validated on ${slide.site.trim()} tissue.`,
      });
    }
  }
  if (slide.typedCells < WARNING_RULES.minimumTypedCells) return warnings;
  const referenceConfident = typer.testSetConfidentShare;
  if (
    referenceConfident !== undefined &&
    referenceConfident >= WARNING_RULES.minimumReferenceConfident &&
    slide.confidentShare < WARNING_RULES.confidentRatio * referenceConfident
  ) {
    warnings.push({
      kind: "out-of-distribution",
      text: `${typer.name} is confident on ${percent(slide.confidentShare)} of cells here against ${percent(referenceConfident)} on its test set. This slide may differ from what it was trained on.`,
    });
  }
  const referenceUnsure = typer.testSetUnsureShare;
  if (
    referenceUnsure !== undefined &&
    slide.unsureShare - referenceUnsure > WARNING_RULES.unsureExcess
  ) {
    warnings.push({
      kind: "many-unsure",
      text: `${typer.name} is unsure on ${percent(slide.unsureShare)} of cells here against ${percent(referenceUnsure)} on its test set.`,
    });
  }
  return warnings;
}
