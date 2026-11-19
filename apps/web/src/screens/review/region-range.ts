import { formatMillimetres, type LengthUnits } from "../../measure/length-units.ts";

export type RegionRange =
  | { readonly kind: "none" }
  | { readonly kind: "unknown"; readonly count: number }
  | { readonly kind: "one"; readonly count: number; readonly size: string }
  | { readonly kind: "range"; readonly count: number; readonly low: string; readonly high: string };

export function regionRange(
  sizes: readonly (number | null | undefined)[],
  units?: LengthUnits,
): RegionRange {
  const count = sizes.length;
  if (count === 0) return { kind: "none" };
  const known = sizes.filter((size): size is number => size != null);
  if (known.length === 0) return { kind: "unknown", count };
  const low = formatMillimetres(Math.min(...known), 1, units);
  const high = formatMillimetres(Math.max(...known), 1, units);
  return low === high ? { kind: "one", count, size: high } : { kind: "range", count, low, high };
}
