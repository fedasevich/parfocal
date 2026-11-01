import type { ProjectCode } from "./scenario.ts";

export type ProjectOverviewSeed = {
  objects: number | null;
  needsReview: number;
  noResults: number;
  storageAllowanceGb: number | null;
  storageUsedGb: number;
  importFailure: {
    file: string;
    slide: string;
    objects: number;
    reason: string;
  } | null;
};

export const projectOverviews: Record<ProjectCode, ProjectOverviewSeed> = {
  P07: {
    objects: 412880,
    needsReview: 8,
    noResults: 2,
    storageAllowanceGb: 525,
    storageUsedGb: 521.2,
    importFailure: {
      file: "lab_model_v3.geojson",
      slide: "tumor_044",
      objects: 412,
      reason: "which usually means the wrong pyramid level",
    },
  },
  P03: {
    objects: null,
    needsReview: 4,
    noResults: 0,
    storageAllowanceGb: null,
    storageUsedGb: 230,
    importFailure: null,
  },
  P09: {
    objects: null,
    needsReview: 22,
    noResults: 0,
    storageAllowanceGb: null,
    storageUsedGb: 310,
    importFailure: null,
  },
  P11: {
    objects: null,
    needsReview: 0,
    noResults: 22,
    storageAllowanceGb: null,
    storageUsedGb: 140,
    importFailure: null,
  },
};

export const objectsPerSlide = 6770;

export const caseSlideCounts: Record<string, number> = {
  "S26-04812": 3,
  "S26-04769": 9,
  "S26-04777": 2,
  "S26-04740": 2,
  "S26-04751": 1,
};

export const classMappings = [
  { source: "Neoplastic", to: "Tumor" },
  { source: "tumour_cell", to: "Tumor" },
  { source: "lymphocyte", to: "Immune" },
] as const;

export const taxonomyClasses = {
  "sentinel-node": [
    { key: 1, name: "Tumor", colour: "#f87171" },
    { key: 2, name: "Stroma", colour: "#6ee7b7" },
    { key: 3, name: "Immune", colour: "#c084fc" },
    { key: 4, name: "Other", colour: "#fbbf24" },
  ],
  pannuke: [
    { key: 1, name: "Neoplastic", colour: "#f87171" },
    { key: 2, name: "Inflammatory", colour: "#c084fc" },
    { key: 3, name: "Connective", colour: "#6ee7b7" },
    { key: 4, name: "Dead", colour: "#fbbf24" },
    { key: 5, name: "Epithelial", colour: "#fbbf24" },
  ],
} as const;

export type UploadSlideSeed = {
  name: string;
  format: string;
  sizeGb: number;
  caseLabel: string | null;
  steps: { label: string; detail: string }[];
  stepsDone: number;
  running: { percent: number; text: string } | null;
  progress: { percent: number; tone: "ok" | "tiles" | "accent"; text: string };
};

export type PairRule = "auto" | "name" | "id";

export type UploadResultSeed = {
  name: string;
  detail: string;
  pairings: Record<PairRule, { slide: number | null; how: string; warn?: string }>;
};

const processing = (uploaded: string, read: string) => [
  { label: "Uploaded", detail: uploaded },
  { label: "Tiles built", detail: "" },
  { label: "Tissue found", detail: "" },
  { label: "Results read", detail: read },
  { label: "Placed on the slide", detail: "" },
  { label: "IDs given", detail: "" },
];

const noResults = (uploaded: string) => [
  { label: "Uploaded", detail: uploaded },
  { label: "Tiles built", detail: "" },
  { label: "Tissue found", detail: "" },
  { label: "No results", detail: "run a model when it is in" },
];

export const uploadSlides: UploadSlideSeed[] = [
  {
    name: "S26-04812_A1_HE.svs",
    format: "Aperio SVS",
    sizeGb: 1.9,
    caseLabel: "S26-04812",
    steps: [
      { label: "Uploaded", detail: "1.9 GB" },
      { label: "Tiles built", detail: "9 levels" },
      { label: "Tissue found", detail: "52 mm² in 3 pieces" },
      { label: "Results read", detail: "5 regions from the GeoJSON" },
      { label: "Placed on the slide", detail: "level 0, 99% on tissue" },
      { label: "IDs given", detail: "T1 to T5" },
    ],
    stepsDone: 6,
    running: null,
    progress: { percent: 100, tone: "ok", text: "Ready" },
  },
  {
    name: "S26-04812_A2_HE.svs",
    format: "Aperio SVS",
    sizeGb: 1.8,
    caseLabel: "S26-04812",
    steps: processing("1.8 GB", "18,240 cells in the CSV"),
    stepsDone: 1,
    running: { percent: 70, text: "about 1 min" },
    progress: { percent: 70, tone: "tiles", text: "Building tiles · 70%" },
  },
  {
    name: "tumor_031.tif",
    format: "Pyramidal TIFF",
    sizeGb: 2.2,
    caseLabel: null,
    steps: processing("2.2 GB", "heatmap PNG"),
    stepsDone: 0,
    running: { percent: 64, text: "1 min left" },
    progress: { percent: 64, tone: "accent", text: "64% · 1 min" },
  },
  {
    name: "tumor_044.tif",
    format: "Pyramidal TIFF",
    sizeGb: 2.0,
    caseLabel: null,
    steps: processing("2.0 GB", "412 objects"),
    stepsDone: 0,
    running: { percent: 22, text: "3 min left" },
    progress: { percent: 22, tone: "accent", text: "22% · 3 min" },
  },
  {
    name: "tumor_052.tif",
    format: "Pyramidal TIFF",
    sizeGb: 1.7,
    caseLabel: null,
    steps: noResults("1.7 GB"),
    stepsDone: 0,
    running: null,
    progress: { percent: 0, tone: "accent", text: "Waiting" },
  },
  {
    name: "tumor_060.tif",
    format: "Pyramidal TIFF",
    sizeGb: 1.8,
    caseLabel: null,
    steps: noResults("1.8 GB"),
    stepsDone: 0,
    running: null,
    progress: { percent: 0, tone: "accent", text: "Waiting" },
  },
];

export const uploadResults: UploadResultSeed[] = [
  {
    name: "S26-04812_A1_HE.geojson",
    detail: "GeoJSON · 5 regions · 388 KB",
    pairings: {
      auto: { slide: 0, how: "Same folder, same name" },
      name: { slide: 0, how: "Same name" },
      id: { slide: 0, how: "Slide ID inside the file" },
    },
  },
  {
    name: "S26-04812_A2_HE.cells.csv",
    detail: "CSV · 18,240 cells · 1.1 MB",
    pairings: {
      auto: { slide: 1, how: "In a folder named like the slide" },
      name: { slide: 1, how: "Same name" },
      id: { slide: 1, how: "Slide ID column" },
    },
  },
  {
    name: "tumor_031_prob.png",
    detail: "Heatmap PNG · 2.4 MB",
    pairings: {
      auto: { slide: null, how: "In results/, and a PNG has no slide ID inside" },
      name: { slide: 2, how: "Similar name only", warn: "Check this" },
      id: { slide: null, how: "A PNG has no slide ID inside" },
    },
  },
  {
    name: "tumor_044.json",
    detail: "Parfocal JSON · 412 objects · 640 KB",
    pairings: {
      auto: { slide: 3, how: "Slide ID inside the file" },
      name: { slide: 3, how: "Same name" },
      id: { slide: 3, how: "Slide ID inside the file" },
    },
  },
];

export const uploadExtraResults = [
  { name: "S26-04812_A1_HE.cells.csv", detail: "CSV · 9,812 cells · 610 KB" },
  { name: "S26-04812_A2_HE.geojson", detail: "GeoJSON · 4 regions · 296 KB" },
  { name: "tumor_031.geojson", detail: "GeoJSON · 3 regions · 214 KB" },
  { name: "tumor_044.cells.csv", detail: "CSV · 11,406 cells · 702 KB" },
  { name: "tumor_052.geojson", detail: "GeoJSON · 2 regions · 188 KB" },
  { name: "tumor_060.geojson", detail: "GeoJSON · 6 regions · 342 KB" },
];

export const uploadFolderTree = [
  { name: "P07-upload/", note: "", depth: 0 },
  { name: "S26-04812/", note: "a case", depth: 1 },
  { name: "A1_HE.svs", note: "", depth: 2 },
  { name: "A1_HE.geojson", note: "results next to their slide", depth: 2 },
  { name: "A2_HE.svs", note: "", depth: 2 },
  { name: "A2_HE/cells.csv", note: "or in a folder named like the slide", depth: 2 },
  { name: "tumor_031.tif", note: "a loose slide", depth: 1 },
  { name: "results/tumor_031_prob.png", note: "you pick its slide", depth: 1 },
];

export const uploadProblems = [
  {
    kind: "read-error",
    result: 3,
    title: "3 of 412 objects have no class",
    text: "Objects 118, 240 and 391 have no class, so they cannot be shown. Everything else in the file reads fine.",
    lines: [
      { line: "1,284", object: "118", error: '"class" is missing' },
      { line: "2,410", object: "240", error: '"class" is missing' },
      { line: "3,907", object: "391", error: '"class" is missing' },
    ],
    fix: "Import the other 409",
    fixed: "Imported 409 objects, 3 skipped. The error report stays with the result set",
  },
  {
    kind: "scale",
    result: 2,
    title: "The heatmap is at a different scale",
    text: "At level 0 only 4% of it lands on tissue. At level 2, scaled ×4, 97% does.",
    lines: [],
    fix: "Use level 2, ×4",
    fixed: "Placed at level 2, scaled ×4. 97% lands on tissue",
  },
  {
    kind: "new-classes",
    result: 1,
    title: "3 classes are new to P07",
    text: "Map them to the project classes once. P07 remembers the mapping for later files. lymphocyte and Connective were mapped before.",
    lines: [],
    fix: "Save mapping",
    fixed: "Classes mapped and remembered for P07",
  },
] as const;

export const uploadNewClasses = [
  { name: "Neoplastic", cells: 9812, to: "Tumor" },
  { name: "tumour_cell", cells: 412, to: "Tumor" },
  { name: "Epithelial", cells: 315, to: null },
] as const;

export const uploadUnscored = 212;

export const uploadDuplicate = { slide: 0, uploadedOn: "2026-10-12" };

export const uploadStorage = { neededGb: 11.4, leftGb: 3.8, trimmedGb: 3.5, trimmedSlides: 2 };

export const uploadSourceOutage = { source: "s3://fnvltava-scans", at: "10:41", waiting: 2 };

export const uploadDone = { minutes: 7, firstIds: "T1 to T5" };

export const resultPreview = {
  slide_label: "A1 · H&E",
  case_label: "S26-04812",
  beside: "CAMELYON v1.0",
  file: "lab_model_v3.geojson",
  detail: "GeoJSON · 412 KB · 6 regions, 3 classes",
  model: "Lab model",
  version: "3.0",
  checks: [
    "98% of the objects fall on tissue",
    "All 3 classes are known to P07",
    "5 regions overlap T1 to T5 and keep those IDs",
    "1 new region becomes T6",
  ],
  level: 0,
  scale: 1,
  shift: [0, 0],
};

export const formatCheck = {
  file: "S26-04812_A2_HE.cells.csv",
  detail: "CSV · 1.1 MB",
  findings: [
    { tone: "ok", text: "Read as CSV, 18,240 rows" },
    { tone: "ok", text: "Columns found: slide, x, y, cell_type, prob" },
    { tone: "ok", text: "Goes with slide S26-04812_A2_HE in P07" },
    { tone: "warn", text: "3 classes are new to P07. You map them once in Check" },
    { tone: "warn", text: "212 rows have no score" },
  ],
} as const;

export const sourceListings = {
  link: {
    kind: "link",
    address: "https://data.cuni.cz/camelyon16/testing/images/",
  },
  remote: {
    kind: "storage",
    address: "s3://fnvltava-scans/sentinel/2026-10/",
  },
} as const;

export const sourceFiles = [
  {
    name: "tumor_090.tif",
    detail: "2.1 GB · 40x",
    sizeGb: 2.1,
    inProject: false,
    result: { name: "tumor_090.geojson", detail: "GeoJSON · 388 KB" },
  },
  {
    name: "tumor_091.tif",
    detail: "1.9 GB · 40x",
    sizeGb: 1.9,
    inProject: false,
    result: { name: "tumor_091.geojson", detail: "GeoJSON · 402 KB" },
  },
  { name: "tumor_092.tif", detail: "2.4 GB · 40x", sizeGb: 2.4, inProject: false, result: null },
  { name: "tumor_031.tif", detail: "2.2 GB", sizeGb: 2.2, inProject: true, result: null },
];

export const projectImports = {
  watchedFolder: {
    address: "s3://fnvltava-ai/outputs/sentinel/",
    slides: "Read in place",
    results: "Pair by name, then slide ID",
    every: "10 minutes",
    on: true,
  },
  webhook: {
    url: "https://parfocal.fnvltava.cz/hooks/P07/in/whk_8f3a…",
    secretEnd: "c41d",
    abilities: [
      { label: "Add slides by link", on: true },
      { label: "Add result sets to slides", on: true },
      { label: "Create cases from case IDs", on: true },
      { label: "Add slides to a review task", on: false },
    ],
    on: true,
  },
  eventsOut: {
    endpoint: "https://ml.cuailab.cz/parfocal-events",
    lastCall: 200,
    events: [
      { name: "review.submitted", text: "A reviewer submits a slide", on: true },
      { name: "task.disagreements", text: "A task has disagreements to resolve", on: true },
      { name: "task.signed_off", text: "A task is signed off, with the export link", on: true },
      { name: "result_set.added", text: "A result set is imported or a run finishes", on: false },
      { name: "comment.created", text: "Someone comments on an object ID", on: false },
    ],
    on: true,
  },
  token: { end: "3f9a" },
  lastArrival: { at: "09:42", what: "tumor_090 with its results" },
  arrivals: [
    {
      at: "10:42:07",
      event: "slide.add",
      file: "tumor_090.tif + 1 result",
      code: 202,
      result: "Accepted, read in place",
    },
    {
      at: "10:40:51",
      event: "results.add",
      file: "tumor_044.geojson",
      code: 202,
      result: "Accepted as lab-model 3.0",
    },
    {
      at: "09:15:12",
      event: "results.add",
      file: "batch2_results.json",
      code: 422,
      result: "3 objects have no class",
    },
    {
      at: "08:02:33",
      event: "slide.add",
      file: "tumor_088.tif",
      code: 401,
      result: "Bad signature",
    },
  ],
};
