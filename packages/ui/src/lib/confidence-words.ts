export type WordingMode = "plain" | "percent" | "frequency";

export const DEFAULT_WORDING: WordingMode = "plain";

export type ConfidenceBand = "confident" | "likely" | "unsure" | "doubtful";

export type BandCutoffs = {
  confident: number;
  likely: number;
  unsure: number;
};

export const BAND_CUTOFFS: BandCutoffs = { confident: 0.8, likely: 0.55, unsure: 0.4 };

export const CLOSE_GAP = 0.1;

export type TyperEvidence = {
  name: string;
  calibrated: boolean;
  checkedOnHeldOut: boolean;
  cutoffs?: BandCutoffs;
  bandAccuracy: Partial<Record<ConfidenceBand, number>>;
};

export type TypeCall = {
  label: string;
  probability: number;
};

export type Shape = ConfidenceBand | "close";

export type ConfidenceWords = {
  mode: WordingMode;
  band: ConfidenceBand;
  shape: Shape;
  text: string;
};

export function bandOf(probability: number, cutoffs: BandCutoffs = BAND_CUTOFFS): ConfidenceBand {
  if (probability >= cutoffs.confident) return "confident";
  if (probability >= cutoffs.likely) return "likely";
  if (probability >= cutoffs.unsure) return "unsure";
  return "doubtful";
}

const ranked = (calls: readonly TypeCall[]) =>
  [...calls].sort((a, b) => b.probability - a.probability);

export function shapeOf(calls: readonly TypeCall[], cutoffs: BandCutoffs = BAND_CUTOFFS): Shape {
  const [first, second] = ranked(calls);
  if (!first) throw new Error("A type call needs at least one class");
  const band = bandOf(first.probability, cutoffs);
  if (band === "doubtful") return band;
  if (second && first.probability - second.probability < CLOSE_GAP) return "close";
  return band;
}

export function effectiveMode(mode: WordingMode, typer: TyperEvidence): WordingMode {
  if (mode === "percent") return mode;
  return typer.calibrated && typer.checkedOnHeldOut ? mode : "percent";
}

const percent = (probability: number) => `${Math.round(probability * 100)}%`;

function plainText(shape: Shape, first: TypeCall, second: TypeCall | undefined): string {
  const pair = second ? `${first.label} or ${second.label}` : first.label;
  switch (shape) {
    case "confident":
      return first.label;
    case "likely":
      return `probably ${first.label}`;
    case "unsure":
      return `possibly ${first.label}`;
    case "close":
      return pair;
    case "doubtful":
      return `unclear, perhaps ${pair}`;
  }
}

function frequencyText(band: ConfidenceBand, first: TypeCall, typer: TyperEvidence): string {
  const accuracy = typer.bandAccuracy[band];
  if (accuracy === undefined) return `${first.label}, not measured at this confidence`;
  return `${first.label}, right about ${Math.round(accuracy * 10)} in 10 times`;
}

function percentText(shape: Shape, first: TypeCall, second: TypeCall | undefined): string {
  const top = `${first.label} ${percent(first.probability)}`;
  if ((shape === "close" || shape === "doubtful") && second) {
    return `${top} or ${second.label} ${percent(second.probability)}`;
  }
  return top;
}

export function confidenceWords(
  calls: readonly TypeCall[],
  mode: WordingMode,
  typer: TyperEvidence,
): ConfidenceWords {
  const cutoffs = typer.cutoffs ?? BAND_CUTOFFS;
  const [first, second] = ranked(calls);
  if (!first) throw new Error("A type call needs at least one class");
  const band = bandOf(first.probability, cutoffs);
  const shape = shapeOf(calls, cutoffs);
  const used = effectiveMode(mode, typer);
  const text =
    used === "plain"
      ? plainText(shape, first, second)
      : used === "frequency"
        ? frequencyText(band, first, typer)
        : percentText(shape, first, second);
  return { mode: used, band, shape, text };
}
