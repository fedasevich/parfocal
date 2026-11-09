import type { ResultSetTyper, TrackRecord } from "@parfocal/api-client";

export function trackRecordLines(record: TrackRecord | undefined, typerName: string): string[] {
  const entry = record?.typers.find((item) => item.typer === typerName);
  if (entry === undefined || entry.checked === 0) return [];
  const lines = [`You kept ${entry.kept} of the ${entry.checked} calls you checked.`];
  if (entry.overall_kept_share !== null) {
    lines.push(
      `Weighted over the model's test set that is ${Math.round(entry.overall_kept_share * 100)}%.`,
    );
  }
  return lines;
}

export function calibrationLines(typer: ResultSetTyper | undefined): string[] {
  if (typer === undefined) return [];
  const sites = typer.validated_sites.length;
  const lines = [
    typer.calibrated
      ? "The confidence was calibrated on held-out slides."
      : "The confidence was not calibrated, so read it as a ranking.",
    sites === 0
      ? "No site has validated it yet."
      : `Validated on ${sites} ${sites === 1 ? "site" : "sites"}.`,
  ];
  if (typer.test_set_accuracy !== null) {
    lines.push(`Test set accuracy ${Math.round(typer.test_set_accuracy * 100)}%.`);
  }
  return lines;
}
