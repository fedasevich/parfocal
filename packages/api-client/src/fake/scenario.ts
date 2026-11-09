export const scenarioToday = "2026-10-17";

export type PersonKey = "LM" | "AK" | "SM" | "JR" | "TB" | "PK" | "HL" | "MV" | "DH";

export type ScenarioPerson = {
  key: PersonKey;
  id: string;
  name: string;
  title: string;
  email: string;
  colour: number;
  role: "researcher" | "reviewer";
};

export type ScenarioWorkspace = {
  id: string;
  slug: string;
  name: string;
  subtitle: string;
  organisation: string;
  kind: "diagnostic" | "research";
};

export type SeededProjectCode = "P07" | "P03" | "P09" | "P11";

export type ProjectCode = SeededProjectCode | `P${number}`;

export type ScenarioProject = {
  code: ProjectCode;
  id: string;
  name: string;
  privacy: "de-identified" | "clinical";
  template: "none" | "sentinel-node" | "cell-review";
  studyTemplate: string;
  taxonomy: string;
  colour: number;
  owner: PersonKey;
  members: PersonKey[];
  createdAt: string;
  counts: ProjectCounts;
};

export type ProjectCounts = {
  cases: number;
  slides: number;
  resultSets: number;
  reviewedPercent: number;
};

export type ScenarioCase = {
  id: string;
  label: string;
  project: ProjectCode;
  specimen: string;
  folder: string;
};

export type ScenarioSlide = {
  id: string;
  project: ProjectCode;
  caseLabel: string | null;
  label: string;
  stain: string;
  state: "ready" | "processing";
  file: string;
  sets: ResultSetKey[];
  remote?: string;
};

export type ResultSetKey = "cam" | "sam" | "rev";

export type ScenarioResultSet = {
  key: ResultSetKey;
  id: string;
  project: ProjectCode;
  name: string;
  version: string;
  source: "imported" | "run" | "reviewed";
  createdOn: string;
  by: PersonKey;
  regions: number;
  cells: number;
};

export type ScenarioReviewTask = {
  code: string;
  id: string;
  name: string;
  project: ProjectCode;
  resultSet: ResultSetKey;
  reviewers: PersonKey[];
  scope: "all-regions" | "random-cells" | "cells-below-score" | "inside-rois" | "unsure-zones";
  scopeText: string;
  dueOn: string;
  sentOn: string;
  slides: number;
  split: "all" | "even";
  progress: Partial<Record<PersonKey, number>>;
  blinded: boolean;
  aiHiddenFirstRead?: boolean;
  status: "review" | "assigned" | "signed";
  analysisTemplate?: ScenarioProject["template"];
  signedOn?: string;
  ownerView?: {
    progress: Partial<Record<PersonKey, number>>;
    openDisagreements: number;
  };
};

export type ScenarioJob = {
  id: string;
  kind: "upload" | "model-run" | "import";
  title: string;
  project: ProjectCode;
  status: "running" | "paused" | "done";
  unitsDone: number;
  unitsTotal: number;
  createdAt: string;
  finishedAt: string | null;
  by: PersonKey;
  detail: string;
  percent: number;
  minutesLeft: number | null;
};

export const uuid = (group: number, index: number) =>
  `00000000-0000-4000-8${String(group).padStart(3, "0")}-${String(index).padStart(12, "0")}`;

const person = (
  key: PersonKey,
  index: number,
  name: string,
  title: string,
  colour: number,
  role: ScenarioPerson["role"] = "reviewer",
): ScenarioPerson => ({
  key,
  id: uuid(1, index),
  name,
  title,
  email: `${name.split(" ")[0]?.toLowerCase() ?? key.toLowerCase()}@fnvltava.example`,
  colour,
  role,
});

export const people: Record<PersonKey, ScenarioPerson> = {
  LM: person("LM", 1, "Lenka Malá", "Consultant · breast, nodes", 0),
  AK: person("AK", 2, "Anna Kopecká", "Consultant · breast", 1),
  SM: person("SM", 3, "Simona Marková", "Consultant · consults", 2),
  JR: person("JR", 4, "Jan Růžička", "Consultant · GI, nodes", 3),
  TB: person("TB", 5, "Tomáš Beneš", "Pathologist · nodes", 4),
  PK: person("PK", 6, "Petra Králová", "On leave until 22 Oct", 5),
  HL: person("HL", 7, "Hana Lukešová", "Histology technician", 6),
  MV: person("MV", 8, "Martin Vlček", "IHC technician", 7),
  DH: person("DH", 9, "Daniel Hruška", "Researcher · AI evaluation", 8, "researcher"),
};

export const signedInAs: PersonKey = "LM";

export const workspaces: ScenarioWorkspace[] = [
  {
    id: uuid(2, 1),
    slug: "fn-vltava",
    name: "Fakultní nemocnice Vltava",
    subtitle: "Pathology and AI research",
    organisation: "FN Vltava",
    kind: "research",
  },
  {
    id: uuid(2, 2),
    slug: "cu-ai-lab",
    name: "Charles University AI Lab",
    subtitle: "Research workspace",
    organisation: "Charles University",
    kind: "research",
  },
];

export const projects: ScenarioProject[] = [
  {
    code: "P07",
    id: uuid(3, 7),
    name: "Sentinel node AI evaluation",
    privacy: "de-identified",
    template: "sentinel-node",
    studyTemplate: "Sentinel node AI evaluation",
    taxonomy: "Sentinel node",
    colour: 0,
    owner: "DH",
    members: ["DH", "LM", "SM", "AK"],
    createdAt: "2026-09-02T09:00:00Z",
    counts: { cases: 24, slides: 61, resultSets: 3, reviewedPercent: 62 },
  },
  {
    code: "P03",
    id: uuid(3, 3),
    name: "Lymph nodes 2026",
    privacy: "clinical",
    template: "sentinel-node",
    studyTemplate: "Sentinel node AI evaluation",
    taxonomy: "Sentinel node",
    colour: 1,
    owner: "LM",
    members: ["LM", "SM", "TB", "JR"],
    createdAt: "2026-01-12T09:00:00Z",
    counts: { cases: 12, slides: 31, resultSets: 1, reviewedPercent: 40 },
  },
  {
    code: "P09",
    id: uuid(3, 9),
    name: "Breast TILs, cell typing",
    privacy: "de-identified",
    template: "cell-review",
    studyTemplate: "Cell typing study",
    taxonomy: "PanNuke",
    colour: 2,
    owner: "DH",
    members: ["DH", "AK", "SM", "LM"],
    createdAt: "2026-09-21T09:00:00Z",
    counts: { cases: 0, slides: 40, resultSets: 3, reviewedPercent: 18 },
  },
  {
    code: "P11",
    id: uuid(3, 11),
    name: "Colon biopsies, model B pilot",
    privacy: "de-identified",
    template: "none",
    studyTemplate: "Detection study",
    taxonomy: "Colon",
    colour: 3,
    owner: "JR",
    members: ["JR", "DH"],
    createdAt: "2026-10-05T09:00:00Z",
    counts: { cases: 8, slides: 22, resultSets: 2, reviewedPercent: 0 },
  },
];

const scenarioCase = (
  index: number,
  label: string,
  project: ProjectCode,
  specimen: string,
  folder: string,
): ScenarioCase => ({ id: uuid(4, index), label, project, specimen, folder });

export const cases: ScenarioCase[] = [
  scenarioCase(1, "S26-04812", "P07", "Sentinel lymph node, left axilla", "Lymph nodes"),
  scenarioCase(2, "S26-04769", "P07", "Axillary dissection, 14 nodes", "Lymph nodes"),
  scenarioCase(3, "S26-04777", "P07", "Sentinel lymph node, right axilla", "Lymph nodes"),
  scenarioCase(4, "S26-04740", "P07", "Lymph node, cervical", "Lymph nodes"),
  scenarioCase(5, "S26-04751", "P07", "Sentinel lymph node, left axilla", "Lymph nodes"),
  scenarioCase(6, "S26-04820", "P03", "Breast core biopsy, right", "Breast"),
  scenarioCase(7, "S26-04728", "P03", "Skin excision, back", "Skin"),
  scenarioCase(8, "S26-04733", "P11", "Colon biopsies, 4 sites", "GI"),
];

const slide = (
  index: number,
  project: ProjectCode,
  caseLabel: string | null,
  label: string,
  stain: string,
  more: Partial<Pick<ScenarioSlide, "state" | "file" | "sets" | "remote">> = {},
): ScenarioSlide => ({
  id: uuid(5, index),
  project,
  caseLabel,
  label,
  stain,
  state: "ready",
  file: `${caseLabel ? `${caseLabel}_${label}_${stain.replace("&", "")}.svs` : `${label}.tif`}`,
  sets: ["cam"],
  ...more,
});

export const slides: ScenarioSlide[] = [
  slide(1, "P07", "S26-04812", "A1", "H&E", { sets: ["cam", "sam", "rev"] }),
  slide(2, "P07", "S26-04812", "A2", "H&E"),
  slide(3, "P07", "S26-04812", "A3", "CK", {
    state: "processing",
    file: "S26-04812_A3_CK.ndpi",
    sets: [],
  }),
  slide(4, "P07", null, "tumor_031", "H&E"),
  slide(5, "P07", null, "tumor_044", "H&E", { sets: ["sam"] }),
  slide(14, "P07", null, "tumor_052", "H&E", { sets: [] }),
  slide(15, "P07", null, "tumor_090", "H&E", {
    file: "s3://fnvltava-scans/…/tumor_090.tif",
    remote: "S3",
  }),
  slide(6, "P07", "S26-04769", "A1", "H&E"),
  slide(7, "P07", "S26-04777", "A1", "H&E"),
  slide(8, "P07", "S26-04740", "A1", "H&E"),
  slide(9, "P07", "S26-04751", "A1", "H&E"),
  slide(10, "P03", "S26-04820", "A1", "H&E"),
  slide(11, "P03", "S26-04728", "A1", "H&E"),
  slide(12, "P11", "S26-04733", "A1", "H&E"),
  slide(13, "P09", null, "LN-0141", "H&E"),
];

export const resultSets: ScenarioResultSet[] = [
  {
    key: "cam",
    id: uuid(6, 1),
    project: "P07",
    name: "CAMELYON tumor model",
    version: "v1.0",
    source: "imported",
    createdOn: "2026-10-12",
    by: "DH",
    regions: 5,
    cells: 0,
  },
  {
    key: "sam",
    id: uuid(6, 2),
    project: "P07",
    name: "PathoSAM + HoVer-NeXt",
    version: "v1.2",
    source: "run",
    createdOn: "2026-10-13",
    by: "DH",
    regions: 5,
    cells: 18240,
  },
  {
    key: "rev",
    id: uuid(6, 3),
    project: "P07",
    name: "Reviewed",
    version: "live",
    source: "reviewed",
    createdOn: scenarioToday,
    by: "LM",
    regions: 6,
    cells: 18238,
  },
];

export const reviewTasks: ScenarioReviewTask[] = [
  {
    code: "RT-14",
    id: uuid(7, 14),
    name: "Round 2 · CAMELYON v1.0",
    project: "P07",
    resultSet: "cam",
    reviewers: ["LM", "SM"],
    scope: "all-regions",
    scopeText: "Tumor regions: all · Cells: random 50 per slide",
    dueOn: "2026-10-23",
    sentOn: "2026-10-09",
    slides: 12,
    split: "all",
    progress: { LM: 7, SM: 4 },
    blinded: true,
    status: "review",
    ownerView: { progress: { LM: 12, SM: 12 }, openDisagreements: 7 },
  },
  {
    code: "RT-15",
    id: uuid(7, 15),
    name: "PathoSAM vs CAMELYON",
    project: "P07",
    resultSet: "sam",
    reviewers: ["AK"],
    scope: "unsure-zones",
    scopeText: "Unsure zones only",
    dueOn: "2026-10-27",
    sentOn: "2026-10-14",
    slides: 12,
    split: "all",
    progress: { AK: 0 },
    blinded: true,
    status: "assigned",
  },
  {
    code: "RT-11",
    id: uuid(7, 11),
    name: "TIL typing, first 40",
    project: "P09",
    resultSet: "sam",
    reviewers: ["AK", "SM", "LM"],
    scope: "cells-below-score",
    scopeText: "Cells below 0.6 confidence",
    dueOn: "2026-10-19",
    sentOn: "2026-10-02",
    slides: 40,
    split: "even",
    progress: { AK: 14, SM: 13, LM: 13 },
    blinded: true,
    status: "signed",
    signedOn: "2026-10-14",
  },
  {
    code: "RT-09",
    id: uuid(7, 9),
    name: "Round 1 · CAMELYON v1.0",
    project: "P07",
    resultSet: "cam",
    reviewers: ["LM", "SM"],
    scope: "all-regions",
    scopeText: "Tumor regions: all",
    dueOn: "2026-10-09",
    sentOn: "2026-09-25",
    slides: 12,
    split: "all",
    progress: { LM: 12, SM: 12 },
    blinded: true,
    status: "signed",
    signedOn: "2026-10-09",
  },
];

export const jobs: ScenarioJob[] = [
  {
    id: uuid(8, 4),
    kind: "upload",
    title: "Upload into P07",
    project: "P07",
    status: "running",
    unitsDone: 2,
    unitsTotal: 6,
    createdAt: "2026-10-15T14:21:00+02:00",
    finishedAt: null,
    by: "DH",
    detail: "6 slides and 4 result files",
    percent: 46,
    minutesLeft: 3,
  },
  {
    id: uuid(8, 2),
    kind: "model-run",
    title: "CAMELYON tumor model v1.0",
    project: "P07",
    status: "paused",
    unitsDone: 0,
    unitsTotal: 1,
    createdAt: "2026-10-15T08:20:00+02:00",
    finishedAt: null,
    by: "DH",
    detail: "tumor_044",
    percent: 38,
    minutesLeft: null,
  },
  {
    id: uuid(8, 5),
    kind: "upload",
    title: "Upload into P09",
    project: "P09",
    status: "done",
    unitsDone: 12,
    unitsTotal: 12,
    createdAt: "2026-10-15T08:58:00+02:00",
    finishedAt: "2026-10-15T09:12:00+02:00",
    by: "DH",
    detail: "12 slides",
    percent: 100,
    minutesLeft: null,
  },
  {
    id: uuid(8, 3),
    kind: "model-run",
    title: "HoVer-Net v2.1",
    project: "P09",
    status: "done",
    unitsDone: 4,
    unitsTotal: 4,
    createdAt: "2026-10-14T16:02:00+02:00",
    finishedAt: "2026-10-14T16:36:00+02:00",
    by: "AK",
    detail: "4 slides in P09",
    percent: 100,
    minutesLeft: null,
  },
];

export const objectIds = {
  region: (index: number) => `T${index + 1}`,
  cell: (cell: number, region = 0) => `T${region + 1}·C${cell + 101}`,
  zone: (index: number) => `Z${index + 1}`,
  full: (project: ProjectCode, caseLabel: string, slideLabel: string, short: string) =>
    `${project}/${caseLabel}/${slideLabel}/${short}`,
};

export const resumePoint = {
  task: "RT-14",
  project: "P07" as ProjectCode,
  caseLabel: "S26-04812",
  slideLabel: "A1",
  object: objectIds.region(4),
  position: 7,
};

export const fullObjectIdPattern = /^P\d{2}\/S\d{2}-\d{5}\/[A-Z]\d+\/[TZRM]\d+(·C\d+)?$/;

export function projectByCode(code: ProjectCode): ScenarioProject {
  const project = projects.find((candidate) => candidate.code === code);
  if (project === undefined) throw new Error(`no scenario project ${code}`);
  return project;
}

export function slideOf(project: ProjectCode, caseLabel: string | null, label: string) {
  const found = slides.find(
    (candidate) =>
      candidate.project === project &&
      candidate.caseLabel === caseLabel &&
      candidate.label === label,
  );
  if (found === undefined) throw new Error(`no scenario slide ${caseLabel ?? ""}/${label}`);
  return found;
}

export const scenarioNow = "2026-10-15T14:30:00+02:00";

export type ReviewState = "assigned" | "in-review" | "submitted";

export const slideReviews: { task: string; slide: number; by: PersonKey; state: ReviewState }[] = [
  { task: "RT-14", slide: 1, by: "LM", state: "in-review" },
  { task: "RT-14", slide: 1, by: "SM", state: "submitted" },
  { task: "RT-14", slide: 2, by: "LM", state: "assigned" },
  { task: "RT-14", slide: 2, by: "SM", state: "assigned" },
  { task: "RT-15", slide: 4, by: "AK", state: "submitted" },
  { task: "RT-15", slide: 5, by: "AK", state: "in-review" },
];

export const slideByIndex = (index: number) => {
  const found = slides.find((candidate) => candidate.id === uuid(5, index));
  if (found === undefined) throw new Error(`no scenario slide ${index}`);
  return found;
};

export const myWorkSlideIds = [1, 2, 3, 4, 5, 14, 15].map((index) => uuid(5, index));

export const week = {
  since: "2026-10-12",
  objectsChecked: 147,
  agreed: 119,
  openDisagreements: 3,
};

export type ScenarioAnnouncement = {
  id: string;
  kind: "model" | "slowdown" | "change";
  text: string;
  createdAt: string;
  endsAt: string | null;
  createdBy?: string;
};

export const announcements: ScenarioAnnouncement[] = [
  {
    id: uuid(11, 1),
    kind: "model",
    text: "CellViT is now one of Parfocal's models",
    createdAt: "2026-10-14T10:00:00+02:00",
    endsAt: null,
  },
  {
    id: uuid(11, 2),
    kind: "slowdown",
    text: "Lab HoVer-Net fork is slow until 13:00, runs queue",
    createdAt: "2026-10-15T08:30:00+02:00",
    endsAt: "2026-10-15T13:00:00+02:00",
  },
  {
    id: uuid(11, 3),
    kind: "change",
    text: "New: hold Z in any slide for a whole-slide peek",
    createdAt: "2026-10-13T09:00:00+02:00",
    endsAt: null,
  },
];

export type ScenarioNotification = {
  id: string;
  to: PersonKey;
  kind:
    | "mention"
    | "reply"
    | "model-run-finished"
    | "model-run-paused"
    | "upload-done"
    | "upload-refused"
    | "task-signed-off"
    | "task-assigned";
  actor: PersonKey | null;
  title: string;
  detail: string;
  quote?: string;
  objectId?: string;
  slideLabel?: string;
  action: string;
  createdAt: string;
  read: boolean;
};

export const notifications: ScenarioNotification[] = [
  {
    to: "LM",
    id: uuid(12, 1),
    kind: "mention",
    actor: "DH",
    title: "Daniel Hruška mentioned you",
    detail: "asked about T2 on A1: does the boundary run past the fold?",
    quote: "Does the boundary run past the fold?",
    objectId: "T2",
    slideLabel: "A1",
    action: "Open the thread",
    createdAt: "2026-10-15T14:20:00+02:00",
    read: false,
  },
  {
    to: "LM",
    id: uuid(12, 2),
    kind: "reply",
    actor: "SM",
    title: "Simona Marková replied",
    detail: "replied on T1·C145: agree, histiocyte",
    quote: "Agree, histiocyte",
    objectId: "T1·C145",
    slideLabel: "A1",
    action: "Open the thread",
    createdAt: "2026-10-15T13:30:00+02:00",
    read: false,
  },
  {
    to: "LM",
    id: uuid(12, 3),
    kind: "model-run-finished",
    actor: null,
    title: "PathoSAM + HoVer-NeXt finished",
    detail: "tumor_052 and tumor_060 in P07 · a new result set on each",
    action: "See the run",
    createdAt: "2026-10-15T09:12:00+02:00",
    read: false,
  },
  {
    to: "LM",
    id: uuid(12, 4),
    kind: "model-run-paused",
    actor: null,
    title: "CAMELYON run paused at 38%",
    detail: "tumor_044 · the lab server is busy",
    action: "Details",
    createdAt: "2026-10-15T08:41:00+02:00",
    read: false,
  },
  {
    to: "LM",
    id: uuid(12, 5),
    kind: "upload-done",
    actor: null,
    title: "Upload into P07 done",
    detail: "6 slides and 4 result sets · 2 slides without results",
    action: "See the steps",
    createdAt: "2026-10-15T08:20:00+02:00",
    read: false,
  },
  {
    to: "LM",
    id: uuid(12, 6),
    kind: "task-signed-off",
    actor: "DH",
    title: "RT-09 signed off",
    detail: "Evaluation v1 by Daniel Hruška · 660 objects",
    action: "Open the report",
    createdAt: "2026-10-14T17:00:00+02:00",
    read: true,
  },
  {
    to: "LM",
    id: uuid(12, 7),
    kind: "task-assigned",
    actor: "DH",
    title: "Daniel Hruška gave you a review task",
    detail: "RT-14 · Round 2 · CAMELYON v1.0 · 12 slides · due Fri 23 Oct",
    action: "Continue",
    createdAt: "2026-10-09T10:00:00+02:00",
    read: true,
  },
];

export const adjudications = [
  {
    id: uuid(13, 1),
    task: "RT-14",
    adjudicator: "AK" as PersonKey,
    askedBy: "DH" as PersonKey,
    slide: 1,
    objects: ["T4", "T5", "T1·C145"],
    decided: 0,
    sentAt: "2026-10-17T09:00:00+02:00",
  },
];

export const cosignRequests = [
  {
    id: uuid(14, 1),
    from: "TB" as PersonKey,
    to: "LM" as PersonKey,
    caseLabel: "S26-04812",
    slide: 1,
    project: "P03" as ProjectCode,
    sentAt: "2026-10-15T11:20:00+02:00",
  },
];

export const checklist = [
  { key: "confirm-email", label: "Confirm your email", done: true },
  { key: "join-workspace", label: "Join Fakultní nemocnice Vltava", done: true },
  { key: "open-sample", label: "Open the sample project", done: true },
  { key: "guided-review", label: "Review one slide in guided review", done: false },
  { key: "comment", label: "Comment on an object ID", done: false },
  { key: "opinion", label: "Submit your first opinion form", done: false },
] as const;

export const sampleProject = {
  id: uuid(3, 1),
  code: "S01",
  name: "Sample · sentinel nodes",
  colour: 4,
  members: ["LM"] as PersonKey[],
  counts: { cases: 1, slides: 4, resultSets: 2, reviewedPercent: 0 },
};

export const sampleSlides = ["tumor_001", "tumor_002", "tumor_003", "normal_001"].map(
  (label, index) => ({ id: uuid(5, 101 + index), label }),
);

export const threads = [
  {
    id: uuid(15, 1),
    task: "RT-14",
    slide: 1,
    anchor: "T2",
    title: "Does the boundary run past the capsule fold?",
    by: "DH" as PersonKey,
    at: "2026-10-15T10:02:00+02:00",
    last: "2026-10-16T15:22:00+02:00",
    replies: 2,
    open: true,
  },
  {
    id: uuid(15, 2),
    task: "RT-14",
    slide: 1,
    anchor: "T1·C145",
    title: "Histiocyte, not tumor",
    by: "LM" as PersonKey,
    at: "2026-10-15T09:40:00+02:00",
    last: "2026-10-15T11:05:00+02:00",
    replies: 1,
    open: true,
  },
  {
    id: uuid(15, 3),
    task: "RT-14",
    slide: 1,
    anchor: "R2⁺",
    title: "Check this rim on the CK slide",
    by: "LM" as PersonKey,
    at: "2026-10-15T10:44:00+02:00",
    last: "2026-10-15T10:44:00+02:00",
    replies: 0,
    open: true,
  },
  {
    id: uuid(15, 4),
    task: "RT-14",
    slide: 1,
    anchor: "T4",
    title: "Reactive sinus histiocytes, no atypia",
    by: "SM" as PersonKey,
    at: "2026-10-16T15:30:00+02:00",
    last: "2026-10-16T15:30:00+02:00",
    replies: 0,
    open: false,
  },
];

export const slideDecisions = [
  { task: "RT-14", slide: 1, total: 55, agree: 43, disagree: 3, unsure: 2 },
];
