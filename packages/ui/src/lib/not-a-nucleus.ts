export const DETECTOR_SCORE_FLOOR = 0.8;

export const FOREGROUND_FLOOR = 0.5;

export type NucleusEvidence = {
  detectorScore?: number | null | undefined;
  foreground?: number | null | undefined;
};

export function mayNotBeNucleus({ detectorScore, foreground }: NucleusEvidence): boolean {
  if (typeof detectorScore === "number" && detectorScore < DETECTOR_SCORE_FLOOR) return true;
  if (typeof foreground === "number" && foreground < FOREGROUND_FLOOR) return true;
  return false;
}
