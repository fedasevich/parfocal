import type { ReportBlock } from "../generated/api.ts";
import { type PersonKey, type ProjectCode, projects, scenarioNow, workspaces } from "./scenario.ts";

const uuid = (group: number, index: number | string) =>
  `00000000-0000-4000-8${String(group).padStart(3, "0")}-${String(index).padStart(12, "0")}`;

const today = scenarioNow.slice(0, 10);

const at = (time: string, day = today) => `${day}T${time}:00+02:00`;

export const adminRightsHolders: PersonKey[] = ["DH"];

export const adminViewer: PersonKey = "DH";

export const canSignOut: PersonKey[] = ["LM", "SM"];

export const workspaceTotals = {
  people: 24,
  researchers: 9,
  reviewers: 15,
  withAdminRights: 3,
  projects: projects.length,
};

export type MemberActivitySeed = {
  key: PersonKey;
  lastActiveAt: string | null;
};

export const memberActivity: MemberActivitySeed[] = [
  { key: "DH", lastActiveAt: at("14:30") },
  { key: "LM", lastActiveAt: at("14:20") },
  { key: "SM", lastActiveAt: at("15:40", "2026-10-14") },
  { key: "AK", lastActiveAt: at("16:05", "2026-10-14") },
  { key: "JR", lastActiveAt: at("11:40", "2026-10-13") },
  { key: "TB", lastActiveAt: at("13:30") },
  { key: "PK", lastActiveAt: at("09:10", "2026-10-02") },
  { key: "HL", lastActiveAt: at("08:15") },
  { key: "MV", lastActiveAt: at("12:50", "2026-10-14") },
];

export const projectsOf = (key: PersonKey): ProjectCode[] =>
  projects.filter((project) => project.members.includes(key)).map((project) => project.code);

export type InvitationSeed = {
  id: string;
  email: string;
  role: "researcher" | "reviewer";
  adminRights: boolean;
  createdAt: string;
  expiresAt: string;
};

export const invitations: InvitationSeed[] = [
  {
    id: uuid(60, 1),
    email: "ondrej@fnvltava.example",
    role: "reviewer",
    adminRights: false,
    createdAt: at("09:30"),
    expiresAt: at("23:59", "2026-10-23"),
  },
  {
    id: uuid(60, 2),
    email: "eva@fnvltava.example",
    role: "reviewer",
    adminRights: false,
    createdAt: at("16:10", "2026-10-13"),
    expiresAt: at("23:59", "2026-10-27"),
  },
  {
    id: uuid(60, 3),
    email: "karel@cuailab.example",
    role: "researcher",
    adminRights: false,
    createdAt: at("10:00", "2026-10-12"),
    expiresAt: at("23:59", "2026-10-26"),
  },
];

export type AuditSeed = {
  time: string;
  by: PersonKey | "webhook";
  action: string;
  details: string;
  project: ProjectCode;
};

export const auditToday: AuditSeed[] = [
  {
    time: "14:02",
    by: "DH",
    action: "task.signed-off",
    details: "Signed off RT-09, Evaluation v1",
    project: "P07",
  },
  {
    time: "13:40",
    by: "DH",
    action: "decision.changed-after-sign-off",
    details: "Changed T4 on A1 from disagree to unsure",
    project: "P07",
  },
  {
    time: "11:15",
    by: "LM",
    action: "review.submitted",
    details: "Submitted her review of A1 · H&E",
    project: "P07",
  },
  {
    time: "10:42",
    by: "webhook",
    action: "slide.read-in-place",
    details: "Read tumor_090.tif in place",
    project: "P07",
  },
  { time: "10:12", by: "LM", action: "slide.opened", details: "Opened A1 · H&E", project: "P07" },
  {
    time: "09:30",
    by: "DH",
    action: "invitation.created",
    details: "Invited Simona Marková",
    project: "P07",
  },
  {
    time: "08:02",
    by: "webhook",
    action: "webhook.rejected",
    details: "Rejected a call with a bad signature",
    project: "P07",
  },
];

export const auditAt = (time: string) => at(time);

export const auditEventId = (index: number) => uuid(61, index + 1);

export type ServiceAccountSeed = {
  id: string;
  name: string;
  scopes: ("see-slides" | "create-cases" | "upload-slides" | "see-people")[];
  tokenId: string;
  lastUsedAt: string | null;
};

export const serviceAccounts: ServiceAccountSeed[] = [
  {
    id: uuid(62, 1),
    name: "Add result sets to P07",
    scopes: ["see-slides", "upload-slides"],
    tokenId: uuid(63, "3f9a"),
    lastUsedAt: at("10:42"),
  },
  {
    id: uuid(62, 2),
    name: "Add slides and results to P09",
    scopes: ["see-slides", "create-cases", "upload-slides"],
    tokenId: uuid(63, "b21c"),
    lastUsedAt: at("17:20", "2026-10-14"),
  },
  {
    id: uuid(62, 3),
    name: "Read every project",
    scopes: ["see-slides", "see-people"],
    tokenId: uuid(63, "77d0"),
    lastUsedAt: null,
  },
];

export const sessionPolicy = { idleLockMinutes: 15, sessionHours: 8, emergencyHours: 4 };

export const tenant = {
  id: workspaces[0]?.id ?? uuid(2, 1),
  organisationId: uuid(64, 1),
  createdAt: "2026-01-05T09:00:00Z",
};

export type AiModelSeed = {
  id: string;
  name: string;
  version: string;
  source: "parfocal" | "lab";
  makes: string[];
  description: string;
  runsOn: string;
  whoCanRun: string;
  resultSets: number;
  shown: boolean;
  status: "active" | "answering" | "imports-only" | "hidden";
  latencyMs: number | null;
};

const model = (index: number, fields: Omit<AiModelSeed, "id">): AiModelSeed => ({
  id: uuid(65, index),
  ...fields,
});

export const aiModels: AiModelSeed[] = [
  model(1, {
    name: "CAMELYON tumor model",
    version: "v1.0",
    source: "parfocal",
    makes: ["Regions", "Heatmap"],
    description: "Tumor regions and a heatmap",
    runsOn: "Parfocal GPU",
    whoCanRun: "Researchers",
    resultSets: 14,
    shown: true,
    status: "active",
    latencyMs: null,
  }),
  model(2, {
    name: "PathoSAM + HoVer-NeXt",
    version: "v1.2",
    source: "parfocal",
    makes: ["Regions", "Cells"],
    description: "Regions and typed cells",
    runsOn: "Parfocal GPU",
    whoCanRun: "Researchers",
    resultSets: 9,
    shown: true,
    status: "active",
    latencyMs: null,
  }),
  model(3, {
    name: "HoVer-Net",
    version: "v0.9",
    source: "parfocal",
    makes: ["Cells"],
    description: "Cell outlines and types",
    runsOn: "Parfocal GPU",
    whoCanRun: "Researchers",
    resultSets: 3,
    shown: true,
    status: "active",
    latencyMs: null,
  }),
  model(4, {
    name: "SlimSAM-77",
    version: "v1.0",
    source: "parfocal",
    makes: ["Outline where you point"],
    description: "An outline where you point",
    runsOn: "In the browser",
    whoCanRun: "Everyone",
    resultSets: 22,
    shown: true,
    status: "active",
    latencyMs: null,
  }),
  model(5, {
    name: "CellViT",
    version: "v1.0",
    source: "parfocal",
    makes: ["Cells"],
    description: "Cell outlines and types",
    runsOn: "Parfocal GPU",
    whoCanRun: "Nobody while hidden",
    resultSets: 0,
    shown: false,
    status: "hidden",
    latencyMs: null,
  }),
  model(6, {
    name: "Lab HoVer-Net fork",
    version: "v2.1",
    source: "lab",
    makes: ["Cells"],
    description: "Typed cells",
    runsOn: "Your server · ml.cuailab.cz",
    whoCanRun: "Researchers in P07, P09",
    resultSets: 2,
    shown: true,
    status: "answering",
    latencyMs: 410,
  }),
  model(7, {
    name: "Lab model",
    version: "v3.0",
    source: "lab",
    makes: ["Regions"],
    description: "Results imported from files",
    runsOn: "Not run here",
    whoCanRun: "Nobody",
    resultSets: 4,
    shown: true,
    status: "imports-only",
    latencyMs: null,
  }),
];

export type ModelRunSeed = {
  id: string;
  model: string;
  project: ProjectCode;
  slides: number;
  slidesDone: number;
  by: PersonKey;
};

export const runningNow: ModelRunSeed[] = [
  {
    id: uuid(66, 1),
    model: "CAMELYON tumor model",
    project: "P07",
    slides: 12,
    slidesDone: 5,
    by: "DH",
  },
  {
    id: uuid(66, 2),
    model: "Lab HoVer-Net fork",
    project: "P09",
    slides: 40,
    slidesDone: 6,
    by: "JR",
  },
];

export const storage = {
  totalTb: 5,
  inPlaceTb: 3.4,
  parts: [
    { kind: "copied-slides", label: "Copied slides", tb: 0.7 },
    { kind: "tile-cache", label: "Tile cache for remote slides, kept 7 days", tb: 0.3 },
    { kind: "results", label: "Results, IDs and reviews", tb: 0.2 },
  ],
  byProject: [
    { code: "P07", gb: 521.2, capGb: 525 },
    { code: "P09", gb: 310, capGb: null },
    { code: "P03", gb: 230, capGb: null },
    { code: "P11", gb: 140, capGb: null },
  ] as { code: ProjectCode; gb: number; capGb: number | null }[],
  rules: [
    {
      key: "read-only-keys",
      label: "Read-only keys only",
      detail: "Parfocal never writes to a source",
      on: true,
      locked: false,
    },
    {
      key: "read-in-place",
      label: "Read new slides in place",
      detail: "Nothing is copied unless a project asks for it",
      on: true,
      locked: false,
    },
    {
      key: "strip-labels",
      label: "Strip labels in de-identified projects",
      detail: "Always on. Label images never leave the source",
      on: true,
      locked: true,
    },
  ],
};

export type SourceSeed = {
  id: string;
  name: string;
  kind: "s3" | "dicomweb" | "https" | "azure";
  access: string;
  address: string;
  newSlides: "copied" | "in-place";
  health: "answering" | "expiring";
  firstTileMs: number | null;
  expiresInDays: number | null;
};

export const sources: SourceSeed[] = [
  {
    id: uuid(67, 1),
    name: "Scanner archive",
    kind: "s3",
    access: "Amazon S3 · read-only key",
    address: "s3://fnvltava-scans/sentinel/",
    newSlides: "in-place",
    health: "answering",
    firstTileMs: 180,
    expiresInDays: null,
  },
  {
    id: uuid(67, 2),
    name: "Regional PACS",
    kind: "dicomweb",
    access: "DICOMweb · hospital login",
    address: "dicomweb.fnvltava.example",
    newSlides: "copied",
    health: "answering",
    firstTileMs: 240,
    expiresInDays: null,
  },
  {
    id: uuid(67, 3),
    name: "CAMELYON16 mirror",
    kind: "https",
    access: "HTTPS with range requests",
    address: "https://data.cuni.example/camelyon16/",
    newSlides: "in-place",
    health: "answering",
    firstTileMs: 310,
    expiresInDays: null,
  },
  {
    id: uuid(67, 4),
    name: "Lab model outputs",
    kind: "azure",
    access: "Azure Blob · SAS token",
    address: "azure://cuailab/outputs/",
    newSlides: "in-place",
    health: "expiring",
    firstTileMs: null,
    expiresInDays: 3,
  },
];

export type WebhookSeed = {
  id: string;
  name: string;
  direction: "incoming" | "outgoing";
  events: string[];
  callsToday: number;
  rejectedToday: number;
};

export const webhooks: WebhookSeed[] = [
  {
    id: uuid(68, 1),
    name: "P07 incoming",
    direction: "incoming",
    events: ["result.file"],
    callsToday: 148,
    rejectedToday: 1,
  },
  {
    id: uuid(68, 2),
    name: "P09 incoming",
    direction: "incoming",
    events: ["slide.file", "result.file"],
    callsToday: 12,
    rejectedToday: 0,
  },
  {
    id: uuid(68, 3),
    name: "ml.cuailab.example/parfocal-events",
    direction: "outgoing",
    events: ["review.submitted", "task.signed"],
    callsToday: 3,
    rejectedToday: 0,
  },
];

export const signInMethods = [
  {
    key: "sso",
    label: "Vltava single sign-on",
    detail: "SAML · fnvltava.example · connected",
    on: true,
    locked: false,
  },
  {
    key: "password",
    label: "Email and password",
    detail: "For people without single sign-on",
    on: true,
    locked: false,
  },
  {
    key: "link",
    label: "Sign-in links by email",
    detail: "A one-time link and code, valid 15 minutes",
    on: true,
    locked: false,
  },
  {
    key: "two-factor-admins",
    label: "Two factors with admin rights",
    detail: "Always required",
    on: true,
    locked: true,
  },
];

export const twoFactor = { people: 22, of: workspaceTotals.people };

export const dataRules = [
  {
    key: "log-slides",
    label: "Log every slide opened",
    detail: "Clinical projects always log",
    on: true,
    locked: false,
  },
  {
    key: "watermark",
    label: "Watermark exports",
    detail: "Puts the name of whoever exported on images and PDFs",
    on: false,
    locked: false,
  },
  {
    key: "eu",
    label: "Data stays in the EU",
    detail: "Storage and processing in Prague",
    on: true,
    locked: true,
  },
];

export type BlockKey =
  | "head"
  | "region"
  | "conf"
  | "kappa"
  | "reasons"
  | "opinion"
  | "worst"
  | "slides"
  | "figure"
  | "text"
  | "compare";

export const reportBlockCatalogue: { key: BlockKey; name: string; shows: string }[] = [
  { key: "head", name: "Headline numbers", shows: "The metrics you pick, as tiles" },
  {
    key: "region",
    name: "Region metrics per slide",
    shows: "Sensitivity, precision and Dice on each slide",
  },
  {
    key: "conf",
    name: "Cell type confusion matrix",
    shows: "What the AI said against the consensus",
  },
  {
    key: "kappa",
    name: "Agreement between reviewers",
    shows: "Cohen's κ for regions, cells and the form",
  },
  { key: "reasons", name: "Why reviewers disagreed", shows: "Reason codes, largest first" },
  { key: "opinion", name: "Opinion answers", shows: "The questions you pick from the form" },
  {
    key: "worst",
    name: "Objects, worst first",
    shows: "The objects reviewers disagreed with most",
  },
  {
    key: "slides",
    name: "Per-slide table",
    shows: "Objects, disagreements and time on each slide",
  },
  { key: "figure", name: "Slide figure", shows: "An object on its slide with the reviewed layer" },
  { key: "text", name: "Text", shows: "Methods, notes or a caption you write" },
  { key: "compare", name: "Compare two result sets", shows: "This task next to a second one" },
];

export const templateBlocks: Record<string, BlockKey[]> = {
  sn: ["head", "conf", "reasons", "opinion", "worst"],
  det: ["head", "region", "reasons", "worst", "figure"],
  seg: ["head", "region", "figure", "reasons", "slides"],
  cell: ["head", "conf", "kappa", "reasons", "worst"],
  reader: ["head", "kappa", "opinion", "slides", "text"],
  cam: ["text", "head", "region", "conf", "compare"],
};

const blockName = (key: BlockKey) =>
  reportBlockCatalogue.find((block) => block.key === key)?.name ?? key;

export function toReportBlock(key: BlockKey): ReportBlock {
  const title = blockName(key);
  switch (key) {
    case "head":
      return { kind: "headline-numbers", title, metrics: ["sensitivity", "precision", "kappa"] };
    case "region":
      return { kind: "region-metrics", title, columns: ["sensitivity", "precision", "dice"] };
    case "conf":
      return { kind: "confusion-matrix", title };
    case "kappa":
      return { kind: "reviewer-agreement", title, parts: ["regions", "cells"] };
    case "reasons":
      return { kind: "disagreement-reasons", title };
    case "opinion":
      return { kind: "opinion-answers", title };
    case "worst":
      return { kind: "worst-objects", title };
    case "slides":
      return { kind: "slide-table", title, columns: ["objects", "disagreements", "time"] };
    case "figure":
      return { kind: "slide-figure", title };
    case "text":
      return { kind: "text", title: "Methods" };
    case "compare":
      return { kind: "comparison", title, metrics: ["sensitivity", "dice"] };
  }
}

export const reportBlocksOf = (templateKey: string): ReportBlock[] =>
  (templateBlocks[templateKey] ?? []).map(toReportBlock);

export const templateMadeHere: Record<string, PersonKey> = { cam: "DH" };

export const defaultTemplateKey = "sn";

export const sampleProjectSetup = {
  name: "Sample · sentinel nodes",
  slides: 4,
  resultSets: 2,
  task: "RT-S1",
};

export const signInDeepLink = { task: "RT-14", slide: "A1", caseLabel: "S26-04812" };

export const workspaceBrands = [
  { logo: "FV", colour: "#0f766e", domain: "fnvltava.example" },
  { logo: "CU", colour: "#7c3aed", domain: "cuni.example" },
];

export const institutions = [
  { workspace: 0, protocol: "SAML", domain: "fnvltava.example", matches: true },
  { workspace: 1, protocol: "OpenID Connect", domain: "cuni.example", matches: false },
];

export const expiredSession = { hours: sessionPolicy.sessionHours, lastDecision: "T5 on A1" };

export const noAccess = { viewer: "SM" as PersonKey, project: "P03" as ProjectCode };

export const inviteSeed = {
  invitation: "rt14-simona",
  by: "DH" as PersonKey,
  to: "SM" as PersonKey,
  sentAt: at("12:30"),
  task: "RT-14",
  hours: 3,
  expiresOn: "2026-10-23",
  specialty: "Breast and lymph node pathology",
};

export const joinableWorkspaces = [
  { workspace: 0, members: workspaceTotals.people, projects: projects.length, matchesEmail: true },
  { workspace: 1, members: 11, projects: 3, matchesEmail: false },
];
