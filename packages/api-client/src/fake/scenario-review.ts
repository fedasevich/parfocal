import type { PersonKey, ScenarioReviewTask } from "./scenario.ts";
import { newTask, taskSlides } from "./scenario-task.ts";

const uuid = (group: number, index: number) =>
  `00000000-0000-4000-8${String(group).padStart(3, "0")}-${String(index).padStart(12, "0")}`;

export const rt16: ScenarioReviewTask = {
  code: newTask.code,
  id: newTask.id,
  name: newTask.names[newTask.resultSet],
  project: newTask.project,
  resultSet: newTask.resultSet,
  reviewers: newTask.reviewers,
  scope: "all-regions",
  scopeText: "Tumor regions: all · Cells: random 50 per slide",
  dueOn: newTask.dueOn,
  sentOn: newTask.sentOn,
  slides: newTask.slideIds.filter((id) =>
    taskSlides.some((slide) => slide.id === id && slide.sets.includes(newTask.resultSet)),
  ).length,
  split: "all",
  progress: { LM: 0, SM: 0 },
  blinded: true,
  status: "assigned",
  analysisTemplate: "sentinel-node",
};

export const rt17: ScenarioReviewTask = {
  ...rt16,
  code: "RT-17",
  id: uuid(7, 17),
  name: "First read without the AI · CAMELYON v1.0",
  aiHiddenFirstRead: true,
  analysisTemplate: "none",
};

export const rt13: ScenarioReviewTask = {
  code: "RT-13",
  id: uuid(7, 13),
  name: "Certainty re-read · CAMELYON v1.0",
  project: "P07",
  resultSet: "cam",
  reviewers: ["AK"],
  scope: "all-regions",
  scopeText: "Tumor regions: all",
  dueOn: "2026-10-30",
  sentOn: "2026-10-16",
  slides: 12,
  split: "all",
  progress: { AK: 5 },
  blinded: true,
  status: "review",
};

export const annotateStubTaskId = uuid(7, 21);

export type DecisionStyleKind = "certainty" | "agree" | "yesno" | "blind";

export type ScenarioDecisionStyle = {
  kind: DecisionStyleKind;
  question: string | null;
  agreeFrom: number;
  disagreeTo: number;
};

export const decisionStyles: Record<string, ScenarioDecisionStyle> = {
  "RT-13": { kind: "certainty", question: null, agreeFrom: 4, disagreeTo: 2 },
  "RT-14": { kind: "agree", question: null, agreeFrom: 4, disagreeTo: 2 },
  "RT-16": { kind: "certainty", question: null, agreeFrom: 4, disagreeTo: 2 },
};

export const yesNoQuestion = "Is this tumor?";

export const sentinelClasses = [
  { key: 1, name: "Tumor", colour: "#f87171" },
  { key: 2, name: "Stroma", colour: "#6ee7b7" },
  { key: 3, name: "Immune", colour: "#c084fc" },
  { key: 4, name: "Other", colour: "#fbbf24" },
] as const;

export type ReviewValue = "agree" | "disagree" | "unsure";

export type ScenarioReviewObject = {
  object: string;
  kind: "region" | "cell";
  className: string;
  score: number;
  sizeMm: number | null;
  otherClass: string | null;
  detectorScore: number | null;
  foreground: number | null;
};

const regionScores: [string, number, number][] = [
  ["T1", 0.97, 7.7],
  ["T2", 0.91, 6.2],
  ["T3", 0.74, 1.2],
  ["T4", 0.58, 0.8],
  ["T5", 0.52, 0.4],
];

const sampledCellNumbers: [string, number[]][] = [
  ["T1", [101, 112, 118, 127, 133, 145, 152, 160, 171, 212]],
  ["T2", [188, 193, 204, 219, 226, 231, 240, 247, 255, 263]],
  ["T3", [302, 309, 317, 324, 336, 341, 350, 358, 366, 371]],
  ["T4", [402, 411, 419, 425, 433, 440, 448, 457, 463, 470]],
  ["T5", [503, 508, 516, 522, 531, 539, 544, 552, 560, 567]],
];

const cellScores = [
  0.35, 0.37, 0.41, 0.43, 0.45, 0.46, 0.46, 0.47, 0.48, 0.48, 0.49, 0.53, 0.54, 0.56, 0.56, 0.56,
  0.57, 0.58, 0.59, 0.59, 0.59, 0.6, 0.6, 0.6, 0.61, 0.61, 0.35, 0.39, 0.4, 0.42, 0.47, 0.48, 0.48,
  0.49, 0.49, 0.49, 0.5, 0.52, 0.53, 0.54, 0.54, 0.56, 0.56, 0.57, 0.57, 0.58, 0.58, 0.59, 0.6, 0.6,
];

const lowDetectorScores = new Map([
  [3, 0.72],
  [12, 0.76],
  [46, 0.72],
  [48, 0.64],
]);

const lowForegrounds = new Map([
  [8, 0.41],
  [44, 0.41],
  [49, 0.33],
]);

export const sampledCells: string[] = sampledCellNumbers.flatMap(([region, numbers]) =>
  numbers.map((number) => `${region}·C${number}`),
);

export const reviewObjects: ScenarioReviewObject[] = [
  ...regionScores.map(([object, score, sizeMm]) => ({
    object,
    kind: "region" as const,
    className: "Tumor",
    score,
    sizeMm,
    otherClass: null,
    detectorScore: null,
    foreground: null,
  })),
  ...sampledCells.map((object, index) => ({
    object,
    kind: "cell" as const,
    className: "Tumor",
    score: cellScores[index] ?? 0.5,
    sizeMm: null,
    otherClass: "Immune",
    detectorScore: lowDetectorScores.get(index) ?? 0.91,
    foreground: lowForegrounds.get(index) ?? 0.84,
  })),
];

export type ScenarioDecision = {
  value: ReviewValue;
  reason: "not_class" | "boundary_off" | "two_regions" | "artefact" | "wrong_class" | null;
  note: string | null;
};

const decided = (
  value: ReviewValue,
  reason: ScenarioDecision["reason"] = null,
  note: string | null = null,
): ScenarioDecision => ({ value, reason, note });

const finalDecisionsOfLenka: Record<string, ScenarioDecision> = {
  T2: decided(
    "disagree",
    "boundary_off",
    "Runs past the capsule fold, about 0.4 mm. @Daniel Hruška worth a CK level?",
  ),
  T4: decided("unsure", null, "Need a second look"),
  T5: decided("disagree", "artefact", "Crush artefact at the cut edge."),
  T1·C145: decided("disagree", "wrong_class"),
  T1·C160: decided("disagree"),
  T2·C204: decided("disagree"),
  T1·C212: decided("unsure", null, "Border unclear"),
};

export const openInReview = [
  "T5",
  "T2·C204",
  "T5·C531",
  "T5·C544",
  "T5·C552",
  "T5·C560",
  "T5·C567",
];

export const lenkaFinalDecision = (object: string): ScenarioDecision =>
  finalDecisionsOfLenka[object] ?? decided("agree");

export const lenkaDecisionsInReview = (): Map<string, ScenarioDecision> =>
  new Map(
    reviewObjects
      .filter((item) => !openInReview.includes(item.object))
      .map((item) => [item.object, lenkaFinalDecision(item.object)]),
  );

export const reviewDecisionTimes = (index: number) =>
  `2026-10-15T${String(9 + Math.floor(index / 12)).padStart(2, "0")}:${String((index * 5) % 60).padStart(2, "0")}:00+02:00`;

export const addedByLenka = [{ object: "T6⁺", note: "Missed by the AI, 0.9 mm" }];

export type ScenarioComment = {
  id: string;
  anchor: string;
  by: PersonKey;
  at: string;
  text: string;
  replyTo: string | null;
};

const comment = (
  index: number,
  anchor: string,
  by: PersonKey,
  at: string,
  text: string,
  replyTo: number | null = null,
): ScenarioComment => ({
  id: uuid(21, index),
  anchor,
  by,
  at,
  text,
  replyTo: replyTo === null ? null : uuid(21, replyTo),
});

export const comments: ScenarioComment[] = [
  comment(
    1,
    "T2",
    "DH",
    "2026-10-15T10:02:00+02:00",
    "Does the boundary run past the capsule fold here?",
  ),
  comment(
    2,
    "T2",
    "LM",
    "2026-10-15T10:12:00+02:00",
    "I measure 1.6 mm past it. Extranodal extension, or still inside the capsule?",
    1,
  ),
  comment(
    3,
    "T2",
    "DH",
    "2026-10-15T10:30:00+02:00",
    "The model draws T2 past the fold. If you disagree with the boundary, mark it so it counts in the evaluation.",
    1,
  ),
  comment(4, "T2", "SM", "2026-10-16T15:22:00+02:00", "Boundary looks fine to me."),
  comment(5, "T1·C145", "LM", "2026-10-15T09:40:00+02:00", "Looks like a histiocyte, not tumor."),
  comment(
    6,
    "T1·C145",
    "DH",
    "2026-10-15T11:05:00+02:00",
    "@Lenka Malá agreed. Mark it as immune so it counts.",
    5,
  ),
  comment(7, "R2⁺", "LM", "2026-10-15T10:44:00+02:00", "Check this rim on the CK slide."),
  comment(8, "T4", "SM", "2026-10-16T15:30:00+02:00", "Reactive sinus histiocytes, no atypia."),
];

export const visibleComments = (viewer: PersonKey, blind: boolean, researcher: PersonKey) =>
  comments.filter((item) => !blind || item.by === viewer || item.by === researcher);

export const opinionQuestions = [
  {
    key: "acceptable",
    label: "Is the AI result acceptable for this slide?",
    kind: "scale" as const,
    required: true,
    min: 1,
    max: 5,
    min_label: "unusable",
    max_label: "sign as is",
  },
  {
    key: "main_error",
    label: "Main error type",
    kind: "choice" as const,
    options: ["None", "Missed tumor", "False tumor", "Wrong cell types", "Boundaries"],
  },
  {
    key: "sign_unchanged",
    label: "Would you sign this without changes?",
    kind: "yesno" as const,
    required: true,
  },
  { key: "comment", label: "Comment", kind: "text" as const, max_length: 2000 },
];

export const lenkaOpinion: Record<string, string | number> = {
  acceptable: 4,
  main_error: "Boundaries",
  sign_unchanged: "No",
  comment: "T2 boundary runs past the capsule fold. Cell types in Z1 are mostly right.",
};

export type ScenarioDisplay = {
  locks: { setting: string; reason: string }[];
  presets: { name: string; key: string; settings: Record<string, string | number | boolean> }[];
};

export const taskDisplay: Record<string, ScenarioDisplay> = {
  "RT-14": {
    locks: [
      {
        setting: "order",
        reason: "Everyone sees the objects in the same order, so agreement is fair",
      },
    ],
    presets: [
      { name: "Tumor first", key: "⇧2", settings: { colorBy: "class", order: "size" } },
      {
        name: "Dots, no IDs",
        key: "⇧3",
        settings: { draw: "dots", ids: false, confidence: "word" },
      },
    ],
  },
  "RT-16": { locks: [], presets: [] },
};

export const slideOrder = { position: 8, total: 12, minutesPerSlide: 20 };

export const agreementWithSimona = { with: "SM" as PersonKey, agree: 51, total: 55 };

export const nextSlideFacts = { regions: 2, cells: 50, minutes: 12 };
