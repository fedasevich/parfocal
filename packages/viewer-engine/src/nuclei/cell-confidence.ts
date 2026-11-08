import { isUnsureCall } from "../overlay/outline-modes.ts";
import { UNSURE_FLAG } from "./cell-summary.ts";

export const UNCALIBRATED = 1;
export const PROBABILITY_FLOOR = 1e-7;
const BYTE = 255;

export interface CellConfidence {
  readonly top: number;
  readonly second: number;
  readonly topClass: number;
  readonly shares: readonly number[];
}

export function calibratedShares(
  bytes: ArrayLike<number>,
  temperature: number = UNCALIBRATED,
): number[] {
  const values = Array.from(bytes, (value) => value / BYTE);
  if (temperature === UNCALIBRATED) return values;
  const logits = values.map((value) => Math.log(Math.max(value, PROBABILITY_FLOOR)) / temperature);
  const peak = Math.max(...logits);
  const weights = logits.map((value) => Math.exp(value - peak));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return weights.map((weight) => weight / total);
}

export function confidenceOf(
  probs: Uint8Array | null,
  row: number,
  classes: number,
  temperature: number = UNCALIBRATED,
): CellConfidence | null {
  if (probs === null || classes < 1) return null;
  const start = row * classes;
  if (start + classes > probs.length) return null;
  const shares = calibratedShares(probs.subarray(start, start + classes), temperature);
  let topClass = 0;
  for (let index = 1; index < shares.length; index++) {
    if ((shares[index] ?? 0) > (shares[topClass] ?? 0)) topClass = index;
  }
  let second = 0;
  for (let index = 0; index < shares.length; index++) {
    if (index !== topClass) second = Math.max(second, shares[index] ?? 0);
  }
  return { top: shares[topClass] ?? 0, second, topClass, shares };
}

export function isUnsureCell(confidence: CellConfidence | null, flags: number): boolean {
  if (confidence === null) return (flags & UNSURE_FLAG) !== 0;
  return isUnsureCall(confidence.top, confidence.second);
}
