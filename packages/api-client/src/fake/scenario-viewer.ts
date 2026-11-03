import type { PersonKey } from "./scenario.ts";

export const classCounts = [
  { className: "Tumor", count: 9812 },
  { className: "Stroma", count: 2201 },
  { className: "Immune", count: 5120 },
  { className: "Other", count: 1107 },
];

export const scoreBins = [3, 5, 9, 14, 22, 30, 41, 55, 70, 88];

export const objectsOnA1 = 18246;

export const aiAgainstReviewed = {
  dice: 0.86,
  cellsAgreePercent: 91,
  objects: [
    { object: "T1", agreement: "both" },
    { object: "T2", agreement: "both" },
    { object: "T3", agreement: "both" },
    { object: "T4", agreement: "ai_only" },
    { object: "T5", agreement: "ai_only" },
    { object: "T6⁺", agreement: "reviewer_only" },
  ],
} as const;

export const modelAgainstModel = { dice: 0.81, onlyInA: ["T5"] };

export const reviewerAgainstReviewer = {
  reviewers: ["LM", "SM"] as PersonKey[],
  kappa: 0.71,
  objects: [
    { object: "T1", agreement: "same" },
    { object: "T2", agreement: "split" },
    { object: "T3", agreement: "same" },
    { object: "T4", agreement: "unsure" },
    { object: "T5", agreement: "unsure" },
    { object: "T6⁺", agreement: "same" },
  ],
} as const;

export const aiStillReading = {
  steps: [
    { key: "tissue", state: "done", percent: 100, seconds: 4, fragments: 3 },
    { key: "regions", state: "running", percent: 55, seconds: null, fragments: null },
    { key: "cells", state: "queued", percent: 0, seconds: null, fragments: null },
  ],
  found: ["T1", "T2"],
  later: ["T3", "T4", "T5"],
} as const;
