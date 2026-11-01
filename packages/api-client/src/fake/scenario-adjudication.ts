import type { PersonKey } from "./scenario.ts";

export type QueueValue = "agree" | "disagree" | "unsure";

export type QueueSeedAnswer = {
  by: PersonKey;
  raw: QueueValue;
  reason: string | null;
  note: string | null;
};

export type QueueSeedRow = {
  slide: number;
  slideLabel: string;
  object: string;
  kind: "region" | "cell";
  className: string;
  score: number;
  sizeMm: number | null;
  answers: [QueueSeedAnswer, QueueSeedAnswer];
};

const answer = (
  by: PersonKey,
  raw: QueueValue,
  reason: string | null = null,
  note: string | null = null,
): QueueSeedAnswer => ({ by, raw, reason, note });

export const queueTask = "RT-14";
export const queueTotalObjects = 660;
export const researcher: PersonKey = "DH";
export const adjudicator: PersonKey = "AK";
export const reviewerA: PersonKey = "SM";
export const reviewerB: PersonKey = "LM";
export const lockedBy = { by: "SM" as PersonKey, slidesLeft: 8 };

export const queueRows: QueueSeedRow[] = [
  {
    slide: 1,
    slideLabel: "A1",
    object: "T2",
    kind: "region",
    className: "Tumor",
    score: 0.91,
    sizeMm: 6.2,
    answers: [
      answer(
        "LM",
        "disagree",
        "Boundary is off",
        "Runs past the capsule fold, about 0.4 mm. @Daniel Hruška worth a CK level?",
      ),
      answer("SM", "agree"),
    ],
  },
  {
    slide: 1,
    slideLabel: "A1",
    object: "T4",
    kind: "region",
    className: "Tumor",
    score: 0.58,
    sizeMm: 0.75,
    answers: [
      answer("LM", "unsure", "Need a second look"),
      answer("SM", "disagree", "Not tumor", "Reactive sinus histiocytes, no atypia."),
    ],
  },
  {
    slide: 1,
    slideLabel: "A1",
    object: "T5",
    kind: "region",
    className: "Tumor",
    score: 0.52,
    sizeMm: 0.4,
    answers: [
      answer("LM", "disagree", "Artefact or fold", "Crush artefact at the cut edge."),
      answer("SM", "agree"),
    ],
  },
  {
    slide: 1,
    slideLabel: "A1",
    object: "T1·C212",
    kind: "cell",
    className: "Tumor",
    score: 0.48,
    sizeMm: null,
    answers: [answer("LM", "unsure", "Border unclear"), answer("SM", "agree")],
  },
  {
    slide: 1,
    slideLabel: "A1",
    object: "T1·C145",
    kind: "cell",
    className: "Tumor",
    score: 0.46,
    sizeMm: null,
    answers: [
      answer("LM", "disagree", "It is an immune cell"),
      answer("SM", "disagree", "It is an immune cell", "Histiocyte, bean-shaped nucleus."),
    ],
  },
  {
    slide: 4,
    slideLabel: "tumor_031",
    object: "T1",
    kind: "region",
    className: "Tumor",
    score: 0.88,
    sizeMm: 3.1,
    answers: [
      answer("LM", "agree"),
      answer("SM", "disagree", "Not tumor", "Germinal centre with tingible body macrophages."),
    ],
  },
  {
    slide: 5,
    slideLabel: "tumor_044",
    object: "T2·C88",
    kind: "cell",
    className: "Immune",
    score: 0.52,
    sizeMm: null,
    answers: [
      answer("LM", "disagree", "It is a tumor cell", "Large nucleolus, a tumor cell."),
      answer("SM", "disagree", "It is a tumor cell"),
    ],
  },
];

export const queueKey = (row: Pick<QueueSeedRow, "slideLabel" | "object">) =>
  `${row.slideLabel}:${row.object}`;

export const sentToAdjudicator = ["A1:T4", "A1:T5", "A1:T1·C145"];

export const declinedNote = "Not my area, ask Jan.";

export const adjudicatorDecisions: Record<string, { raw: QueueValue; at: string }> = {
  "A1:T4": { raw: "disagree", at: "2026-10-17T13:30:00+02:00" },
  "A1:T5": { raw: "disagree", at: "2026-10-17T13:34:00+02:00" },
  "A1:T1·C145": { raw: "disagree", at: "2026-10-17T13:37:00+02:00" },
};

export const researcherDecisions: Record<string, { raw: QueueValue; note: string; at: string }> = {
  "A1:T2": {
    raw: "disagree",
    note: "Agree with Lenka, the boundary runs past the fold.",
    at: "2026-10-17T11:05:00+02:00",
  },
  "tumor_044:T2·C88": {
    raw: "disagree",
    note: "Tumor cell, both reviewers were right.",
    at: "2026-10-17T11:12:00+02:00",
  },
};

export const leftOpen = ["A1:T1·C212", "tumor_031:T1"];

export const editedRow = { key: "A1:T2", by: "LM" as PersonKey, on: "2026-10-16" };

export const signature = {
  by: "DH" as PersonKey,
  at: "2026-10-15T14:02:00+02:00",
  checksum: "sha256:8c1f…a90e",
};

export const changesAfterSignOff = [
  {
    by: "DH" as PersonKey,
    at: "2026-10-16T09:12:00+02:00",
    object: "T4",
    slideLabel: "A1",
    text: "disagree changed to not sure",
    reason: "second look with the CK slide",
  },
];

export const resultSetFacts = { name: "CAMELYON v1.0", objects: 660, added: 1 };

export const evaluationNumbers = {
  sensitivity: { value: 0.92, numerator: 46, denominator: 50 },
  precision: { value: 0.88, numerator: 46, denominator: 52 },
  dice: { value: 0.86, numerator: 43, denominator: 50 },
  kappa: 0.71,
  cellsAgreed: { value: 0.91, numerator: 1110, denominator: 1220 },
  cellsBetweenReviewers: { value: 0.94, numerator: 1147, denominator: 1220 },
};

export const reasonCounts: [string, number][] = [
  ["wrong_class", 38],
  ["boundary_off", 21],
  ["not_class", 14],
  ["artefact", 6],
  ["two_regions", 3],
];

export const opinionQuestion = { key: "acceptable", text: "Is the AI result acceptable?" };

export const opinionCounts: Record<string, number> = { "1": 0, "2": 1, "3": 4, "4": 12, "5": 7 };

export const confusion = {
  classes: ["Tumor", "Immune", "Stroma", "Other"],
  counts: [
    [412, 18, 6, 4],
    [21, 388, 12, 9],
    [5, 14, 201, 7],
    [3, 11, 8, 101],
  ],
};

export const worstObjects: {
  object: string;
  what: string;
  answers: [QueueValue, QueueValue];
}[] = [
  { object: "T2", what: "Tumor region", answers: ["disagree", "agree"] },
  { object: "T4", what: "Tumor region", answers: ["unsure", "disagree"] },
  { object: "T5", what: "Tumor region", answers: ["disagree", "agree"] },
  { object: "T1·C212", what: "Tumor cell", answers: ["unsure", "agree"] },
  { object: "T1·C145", what: "Tumor cell", answers: ["disagree", "disagree"] },
  { object: "T1", what: "Tumor region", answers: ["agree", "agree"] },
];

export const reportTemplate = {
  name: "Sentinel node AI evaluation",
  version: 2,
  latestVersion: 3,
  retiredOn: "2026-10-14",
  blocks: [
    { kind: "headline-numbers", title: "Results", width: "full" },
    { kind: "confusion-matrix", title: "Cell types, AI against the consensus", width: "full" },
    { kind: "disagreement-reasons", title: "Why reviewers disagreed", width: "half" },
    { kind: "opinion-answers", title: "Opinion answers", width: "half" },
    { kind: "worst-objects", title: "Objects, worst first", width: "full" },
  ] as const,
};

export const reportFormats = [
  { key: "pdf", label: "PDF, this layout" },
  { key: "docx", label: "Word, this layout, editable" },
  { key: "decisions", label: "Decisions per object, CSV" },
  { key: "objects", label: "Objects with full IDs, CSV" },
  { key: "geojson", label: "Reviewed annotations, GeoJSON" },
];
