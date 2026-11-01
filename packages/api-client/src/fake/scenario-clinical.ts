import { type PersonKey, people, projectByCode, slideOf } from "./scenario.ts";
import { reviewObjects } from "./scenario-review.ts";

const uuid = (group: number, index: number) =>
  `00000000-0000-4000-8${String(group).padStart(3, "0")}-${String(index).padStart(12, "0")}`;

export type ClinicalTemplateKey = "sentinel-node" | "lymph-node-excision";

export type ClinicalStepKey = "findings" | "staging" | "text" | "sign";

export const clinicalTemplates: Record<
  ClinicalTemplateKey,
  { name: string; version: string; steps: { key: ClinicalStepKey; label: string }[] }
> = {
  "sentinel-node": {
    name: "Sentinel node report",
    version: "v2",
    steps: [
      { key: "findings", label: "Findings" },
      { key: "staging", label: "Staging" },
      { key: "text", label: "Report text" },
      { key: "sign", label: "Sign out" },
    ],
  },
  "lymph-node-excision": {
    name: "Lymph node excision report",
    version: "v1",
    steps: [
      { key: "findings", label: "Findings" },
      { key: "text", label: "Report text" },
      { key: "sign", label: "Sign out" },
    ],
  },
};

export const nodeStandards: [string, string][] = [
  ["ICCR", "Surgically removed lymph nodes for breast tumours, 1st ed. v1.2"],
  ["CAP", "Synoptic format and element names, Breast Invasive Resection 4.11"],
  ["TNM", "UICC and AJCC 8th edition, pN with (sn) and (i+)"],
];

export type SignRight = "own" | "any" | "never";

export const clinicalProject = "P03" as const;

export const clinicalRoles: Record<string, "owner" | "reviewer" | "viewer"> = {
  LM: "owner",
  SM: "reviewer",
  TB: "reviewer",
  JR: "viewer",
};

export const signRights: Record<string, SignRight> = {
  LM: "own",
  SM: "own",
  TB: "never",
  JR: "never",
};

export type ClinicalSlide = { key: string; id: string; label: string; node: number; short: string };

export type ClinicalObject = {
  slide: string;
  objectId: string;
  sizeMm: number;
  aiSizeMm: number;
  by: "you" | "ai";
  state: "agree" | "disagree" | "open";
};

export type ClinicalDecision = {
  objectId: string;
  count: "agree" | "disagree" | "unsure";
  why: string;
};

export type ClinicalDepositSeed = { slide: string; objectId: string | null; sizeMm: string };

export type ClinicalCase = {
  label: string;
  template: ClinicalTemplateKey;
  slide: string;
  specimen: string;
  site: string;
  clinical: string;
  assigned: PersonKey[];
  decisions: ClinicalDecision[];
  cells: { agree: number; of: number } | null;
  examined: number | null;
  slides: ClinicalSlide[];
  objects: ClinicalObject[];
  deposits: Partial<Record<PersonKey, ClinicalDepositSeed[]>>;
  receivedAt: string;
  requestedBy: string;
};

const aiRegions = reviewObjects.filter((object) => object.kind === "region");

const measuredByYou = (size: number) => Math.round(size * 1.04 * 10) / 10;

const sentinelObjects: ClinicalObject[] = [
  ...aiRegions.map((region, index) => ({
    slide: "A1",
    objectId: region.object,
    sizeMm: measuredByYou(region.sizeMm ?? 0),
    aiSizeMm: region.sizeMm ?? 0,
    by: "you" as const,
    state: index < 4 ? ("agree" as const) : ("disagree" as const),
  })),
  { slide: "A2", objectId: "T1", sizeMm: 2.4, aiSizeMm: 2.4, by: "ai", state: "open" },
  { slide: "A2", objectId: "T2", sizeMm: 0.6, aiSizeMm: 0.6, by: "ai", state: "open" },
];

export const clinicalCases: ClinicalCase[] = [
  {
    label: "S26-04812",
    template: "sentinel-node",
    slide: "A1",
    specimen: "Sentinel lymph nodes #1 and #2, left axilla, excision",
    site: "Lymph nodes, sentinel, left axilla, excision",
    clinical:
      "Invasive ductal carcinoma, left breast, cT2 N0. Sentinel lymph node biopsy. No neoadjuvant treatment.",
    assigned: ["LM", "TB"],
    decisions: [
      { objectId: "T1", count: "agree", why: "" },
      { objectId: "T2", count: "agree", why: "" },
      { objectId: "T3", count: "agree", why: "" },
      { objectId: "T4", count: "agree", why: "" },
      { objectId: "T5", count: "disagree", why: "artefact" },
    ],
    cells: { agree: 46, of: 50 },
    examined: 2,
    slides: [
      {
        key: "A1",
        id: slideOf("P07", "S26-04812", "A1").id,
        label: "A1 · H&E",
        node: 1,
        short: "A1",
      },
      { key: "A1CK", id: uuid(16, 1), label: "A1 · CK", node: 1, short: "A1 CK" },
      {
        key: "A2",
        id: slideOf("P07", "S26-04812", "A2").id,
        label: "A2 · H&E",
        node: 2,
        short: "A2",
      },
    ],
    objects: sentinelObjects,
    deposits: {
      LM: [
        { slide: "A1", objectId: "T1", sizeMm: "8.0" },
        { slide: "A1", objectId: "T2", sizeMm: "6.4" },
        { slide: "A1", objectId: "T3", sizeMm: "1.3" },
      ],
      TB: [
        { slide: "A1", objectId: "T1", sizeMm: "1.6" },
        { slide: "A1", objectId: "T2", sizeMm: "6.4" },
        { slide: "A1", objectId: "T3", sizeMm: "1.3" },
      ],
    },
    receivedAt: "14 Oct 2026 14:20",
    requestedBy: "MUDr. Pavel Kraus, Surgery",
  },
  {
    label: "S26-04740",
    template: "lymph-node-excision",
    slide: "A1",
    specimen: "Lymph node, right neck, excision",
    site: "Lymph node, right neck, excision",
    clinical: "Enlarged lymph node in the right neck for 6 weeks. No known primary tumor.",
    assigned: ["LM"],
    decisions: [
      { objectId: "T1", count: "disagree", why: "reactive follicle" },
      { objectId: "T2", count: "disagree", why: "reactive follicle" },
    ],
    cells: null,
    examined: null,
    slides: [
      {
        key: "A1",
        id: slideOf("P07", "S26-04740", "A1").id,
        label: "A1 · H&E",
        node: 1,
        short: "A1",
      },
    ],
    objects: [],
    deposits: {},
    receivedAt: "14 Oct 2026 09:05",
    requestedBy: "MUDr. Pavel Kraus, ENT",
  },
];

export const defaultClinicalCase = "S26-04812";

export function clinicalCaseForSlide(slideId: string): ClinicalCase {
  const found = clinicalCases.find((item) => item.slides.some((slide) => slide.id === slideId));
  const fallback = clinicalCases.find((item) => item.label === defaultClinicalCase);
  if (!fallback) throw new Error("no default clinical case");
  return found ?? fallback;
}

export const canSignCase = (key: string, item: ClinicalCase) => {
  const right = clinicalRoles[key] === "viewer" ? "never" : (signRights[key] ?? "never");
  return right === "any" || (right === "own" && item.assigned.includes(key as PersonKey));
};

export const cosignSent = {
  id: uuid(16, 101),
  from: "TB" as PersonKey,
  to: "LM" as PersonKey,
  caseLabel: "S26-04812",
  sentAt: "2026-10-15T11:20:00+02:00",
  values: {
    specimen: "Sentinel lymph nodes #1 and #2, left axilla, excision",
    deposits: [
      { id: "D1", slide: "A1", object_id: "T1", size_mm: "1.6", note: "" },
      { id: "D2", slide: "A1", object_id: "T2", size_mm: "6.4", note: "" },
      { id: "D3", slide: "A1", object_id: "T3", size_mm: "1.3", note: "" },
    ],
    category: "macro" as const,
    examined: "2",
    extranodal: "absent" as const,
    diagnosis:
      "Lymph nodes, sentinel, left axilla, excision: METASTATIC CARCINOMA, macrometastasis, 3 deposits, largest 6.4 mm (1/2).",
    microscopic: "A cohesive deposit of carcinoma in the subcapsular sinus.",
    comment: "",
  },
};

export const clinicalProjectRef = () => {
  const project = projectByCode(clinicalProject);
  return { id: project.id, code: project.code, name: project.name };
};

export const clinicalPersonId = (key: PersonKey) => people[key].id;
