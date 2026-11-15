import type { RequestHandler } from "msw";
import { getGetAiCorrectionsMockHandler } from "../generated/api.msw.ts";
import type { AiCorrections, CorrectionsMonth } from "../generated/api.ts";

const month = (value: string, reviewed: number, corrections: number): CorrectionsMonth => ({
  month: `${value}-01T00:00:00Z`,
  nuclei_reviewed: reviewed,
  corrections,
  per_hundred: Math.round((corrections * 10_000) / reviewed) / 100,
});

const months = [
  month("2026-06", 1800, 414),
  month("2026-07", 2600, 520),
  month("2026-08", 3100, 527),
  month("2026-09", 4200, 588),
  month("2026-10", 5000, 600),
  month("2026-11", 2400, 264),
];

export const toAiCorrections = (): AiCorrections => {
  const reviewed = months.reduce((sum, item) => sum + item.nuclei_reviewed, 0);
  const corrections = months.reduce((sum, item) => sum + item.corrections, 0);
  return {
    since: null,
    until: null,
    nuclei_reviewed: reviewed,
    corrections,
    per_hundred: Math.round((corrections * 10_000) / reviewed) / 100,
    months,
  };
};

export function correctionsHandlers(): RequestHandler[] {
  return [getGetAiCorrectionsMockHandler(() => toAiCorrections())];
}
