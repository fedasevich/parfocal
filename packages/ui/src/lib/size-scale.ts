import { macroMm, microMm } from "./analysis-parts.ts";

export type SizeScaleDot = { number: number; mm: number };

export type SizeScaleInput = {
  min: number;
  max: number;
  low: number;
  high: number;
  point: number;
  cuts: readonly number[];
  dots?: readonly SizeScaleDot[];
};

export type SizeScaleZoneName = "ITC" | "micro" | "macro";

export type SizeScaleZone = { name: SizeScaleZoneName; left: number; width: number };

export const logPosition = (mm: number, min: number, max: number) =>
  ((Math.log10(mm) - Math.log10(min)) / (Math.log10(max) - Math.log10(min))) * 100;

export function sizeScaleGeometry({ min, max, low, high, point, cuts, dots = [] }: SizeScaleInput) {
  const at = (mm: number) => logPosition(mm, min, max);
  const micro = at(microMm);
  const macro = at(macroMm);
  const zones: SizeScaleZone[] = [
    { name: "ITC", left: 0, width: micro },
    { name: "micro", left: micro, width: macro - micro },
    { name: "macro", left: macro, width: 100 - macro },
  ];
  return {
    bandLeft: at(low),
    bandWidth: at(high) - at(low),
    point: at(point),
    cuts: cuts.map((cut) => ({ mm: cut, left: at(cut) })),
    zones,
    dots: dots.map((dot) => ({ number: dot.number, mm: dot.mm, left: at(dot.mm) })),
  };
}

export function countBarGeometry(count: number, line: number, max: number) {
  return {
    fill: Math.min(100, (Math.max(0, count) / max) * 100),
    line: (line / max) * 100,
    over: count >= line,
  };
}
