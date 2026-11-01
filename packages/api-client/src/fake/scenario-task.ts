import {
  type PersonKey,
  people,
  projectByCode,
  resultSets,
  scenarioNow,
  slides,
} from "./scenario.ts";

const uuid = (group: number, index: number) =>
  `00000000-0000-4000-8${String(group).padStart(3, "0")}-${String(index).padStart(12, "0")}`;

export const taskToday = scenarioNow.slice(0, 10);

export type TaskSlideSet = "cam" | "sam";

export type TaskSlide = {
  id: string;
  label: string;
  stain: string;
  caseLabel: string | null;
  specimen: string | null;
  sets: TaskSlideSet[];
};

const caseIds: Record<string, string> = {
  "S26-04812": uuid(40, 1),
  "S26-04769": uuid(40, 2),
  "S26-04777": uuid(40, 3),
};

const specimens: Record<string, string> = {
  "S26-04812": "Sentinel node, left axilla",
  "S26-04769": "Axillary dissection, levels 1 and 2",
  "S26-04777": "Sentinel node, right axilla",
};

let slideIndex = 0;
const taskSlide = (
  caseLabel: string | null,
  label: string,
  sets: TaskSlideSet[],
  stain = "H&E",
): TaskSlide => {
  slideIndex += 1;
  const shared = slides.find(
    (candidate) =>
      candidate.project === "P07" &&
      candidate.caseLabel === caseLabel &&
      candidate.label === label &&
      candidate.stain === stain,
  );
  return {
    id: shared?.id ?? uuid(41, slideIndex),
    label,
    stain,
    caseLabel,
    specimen: caseLabel ? (specimens[caseLabel] ?? null) : null,
    sets,
  };
};

export const taskSlides: TaskSlide[] = [
  taskSlide("S26-04812", "A1", ["cam", "sam"]),
  taskSlide("S26-04812", "A2", ["cam", "sam"]),
  taskSlide("S26-04812", "A3", ["cam", "sam"]),
  ...["B1", "B2", "B3", "B4", "B5", "B6"].map((label, index) =>
    taskSlide("S26-04769", label, index < 3 ? ["cam", "sam"] : ["cam"]),
  ),
  ...["tumor_102", "tumor_105", "tumor_110"].map((label) => taskSlide(null, label, ["sam"])),
  taskSlide("S26-04777", "B1", ["cam"]),
  taskSlide("S26-04777", "B2", ["cam", "sam"]),
  taskSlide("S26-04812", "A1", [], "CK"),
  ...["tumor_052", "tumor_060"].map((label) => taskSlide(null, label, [])),
  taskSlide(null, "tumor_088", ["cam"]),
  taskSlide(null, "tumor_101", ["cam", "sam"]),
];

export const taskCaseId = (caseLabel: string) => caseIds[caseLabel] ?? null;

export const resultSetIdOf = (key: TaskSlideSet) => {
  const set = resultSets.find((candidate) => candidate.key === key);
  if (set === undefined) throw new Error(`no scenario result set ${key}`);
  return set.id;
};

export const taskReviewers: { key: PersonKey; openTasks: number }[] = [
  { key: "LM", openTasks: 3 },
  { key: "SM", openTasks: 1 },
  { key: "AK", openTasks: 2 },
  { key: "JR", openTasks: 0 },
  { key: "TB", openTasks: 0 },
  { key: "PK", openTasks: 0 },
];

export const away: { key: PersonKey; until: string }[] = [{ key: "PK", until: "2026-10-22" }];

export const rois = [
  { key: "R1", name: "Capsule edge" },
  { key: "R2", name: "Subcapsular sinus" },
  { key: "R3", name: "Cortex" },
  { key: "R4", name: "Hilum" },
  { key: "R5", name: "Medulla" },
];

export const unsureZones = [
  { key: "Z1", cellsPerSlide: 14 },
  { key: "Z2", cellsPerSlide: 12 },
  { key: "Z3", cellsPerSlide: 10 },
  { key: "Z4", cellsPerSlide: 9 },
  { key: "Z5", cellsPerSlide: 7 },
];

export type FormKey = "default" | "reader" | "outline";

export const opinionForms: {
  key: FormKey;
  name: string;
  questions: { label: string; kind: "scale" | "choice" | "yesno" | "text"; required: boolean }[];
}[] = [
  {
    key: "default",
    name: "Default opinion form",
    questions: [
      { label: "Is the AI result acceptable for this slide?", kind: "scale", required: true },
      { label: "Main error type", kind: "choice", required: false },
      { label: "Would you sign this without changes?", kind: "yesno", required: true },
      { label: "Comment", kind: "text", required: false },
    ],
  },
  {
    key: "reader",
    name: "Reader study form",
    questions: [
      { label: "Your diagnosis for this slide", kind: "choice", required: true },
      { label: "How sure are you?", kind: "scale", required: false },
      { label: "Comment", kind: "text", required: false },
    ],
  },
  {
    key: "outline",
    name: "Outline quality form",
    questions: [
      { label: "Are the outlines good enough to use?", kind: "scale", required: true },
      { label: "Where are they worst?", kind: "choice", required: false },
      { label: "Comment", kind: "text", required: false },
    ],
  },
];

export type ScopeKind = "regions" | "cells" | "low" | "roi" | "unsure";
export type DecisionKind = "certainty5" | "agree" | "yesno" | "blind";

export type DisplayDefaults = {
  draw: "outline" | "fill" | "dots";
  width: 1 | 2 | 3;
  opacity: number;
  colorBy: "class" | "score" | "decision";
  ids: boolean;
  conf: "number" | "word" | "color" | "hidden";
  heat: number;
  cutoff: number;
  sets: { sam: boolean; cam: boolean; rev: boolean };
  order: "ai" | "size" | "leastsure" | "random";
  zoom: "fit" | "tight" | "context";
  auto: boolean;
  buttons: "right" | "bottom";
};

export const displayDefault: DisplayDefaults = {
  draw: "outline",
  width: 2,
  opacity: 100,
  colorBy: "class",
  ids: true,
  conf: "number",
  heat: 0,
  cutoff: 0.4,
  sets: { cam: true, sam: false, rev: true },
  order: "ai",
  zoom: "fit",
  auto: true,
  buttons: "right",
};

export type ScenarioStudyTemplate = {
  key: string;
  id: string;
  name: string;
  kind: "regions-and-cells" | "regions" | "outlines" | "cells" | "reviewers-first";
  version: number;
  builtIn: "sentinel-node" | "detection" | "segmentation" | "cell-typing" | "reader-study" | null;
  used: number;
  scope: ScopeKind[];
  blind: boolean;
  hide: boolean;
  start: "guided" | "viewer";
  split: "everyone" | "even";
  form: FormKey;
  decision: DecisionKind;
  display: Partial<DisplayDefaults>;
  retired: boolean;
};

const template = (
  index: number,
  fields: Omit<ScenarioStudyTemplate, "id" | "retired" | "blind"> & { blind?: boolean },
): ScenarioStudyTemplate => ({ id: uuid(42, index), retired: false, blind: true, ...fields });

export const studyTemplates: ScenarioStudyTemplate[] = [
  template(1, {
    key: "sn",
    name: "Sentinel node AI evaluation",
    kind: "regions-and-cells",
    version: 3,
    builtIn: "sentinel-node",
    used: 4,
    scope: ["regions", "cells"],
    hide: false,
    start: "guided",
    split: "everyone",
    form: "default",
    decision: "certainty5",
    display: {},
  }),
  template(2, {
    key: "det",
    name: "Detection study",
    kind: "regions",
    version: 1,
    builtIn: "detection",
    used: 2,
    scope: ["regions"],
    hide: false,
    start: "guided",
    split: "everyone",
    form: "default",
    decision: "agree",
    display: {},
  }),
  template(3, {
    key: "seg",
    name: "Segmentation study",
    kind: "outlines",
    version: 1,
    builtIn: "segmentation",
    used: 1,
    scope: ["regions"],
    hide: false,
    start: "viewer",
    split: "even",
    form: "outline",
    decision: "agree",
    display: { width: 1 },
  }),
  template(4, {
    key: "cell",
    name: "Cell typing study",
    kind: "cells",
    version: 2,
    builtIn: "cell-typing",
    used: 3,
    scope: ["cells", "low"],
    hide: false,
    start: "guided",
    split: "everyone",
    form: "default",
    decision: "blind",
    display: { draw: "dots", ids: false },
  }),
  template(5, {
    key: "reader",
    name: "Reader study, first read without AI",
    kind: "reviewers-first",
    version: 1,
    builtIn: "reader-study",
    used: 0,
    scope: ["regions"],
    hide: true,
    start: "viewer",
    split: "everyone",
    form: "reader",
    decision: "yesno",
    display: { conf: "hidden" },
  }),
  template(6, {
    key: "cam",
    name: "CAMELYON rounds",
    kind: "regions-and-cells",
    version: 2,
    builtIn: null,
    used: 2,
    scope: ["regions", "cells"],
    hide: false,
    start: "guided",
    split: "everyone",
    form: "default",
    decision: "certainty5",
    display: {},
  }),
];

const sentinel = studyTemplates[0] as ScenarioStudyTemplate;

const roundName: Record<TaskSlideSet, string> = {
  cam: "Round 3 · CAMELYON v1.0",
  sam: "Round 1 · PathoSAM v1.2",
};

export const newTask = {
  code: "RT-16",
  id: uuid(43, 16),
  project: "P07" as const,
  studyTemplate: sentinel,
  slideIds: taskSlides.slice(0, 12).map((slide) => slide.id),
  resultSet: "cam" as TaskSlideSet,
  names: roundName,
  reviewers: ["LM", "SM"] as PersonKey[],
  dueOn: "2026-10-30",
  reminders: [2, 1],
  sentOn: "2026-10-15",
};

export const newTaskProject = () => projectByCode(newTask.project);

export const reviewerName = (key: PersonKey) => people[key].name;
