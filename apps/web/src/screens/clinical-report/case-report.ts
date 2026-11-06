import type {
  CaseDetail,
  CaseReport,
  CaseReportBlocker,
  CaseReportChange,
  CaseReportSignature,
  CaseReportStaging,
  CaseReportValues,
  CaseReportVersion,
  NewCaseReportDeposit,
  Project,
} from "@parfocal/api-client";
import {
  type Dep,
  depositMm,
  type Issue,
  nodeStandards,
  parseNumber,
  type Report,
  type ReportData,
  type StepKey,
  stepKeys,
  type Values,
  withDiagnosis,
} from "./model.ts";

export type ReportPhase = "editing" | "sent" | "signed";

export const phaseOf = (report: Pick<CaseReport, "state">): ReportPhase =>
  report.state === "signed" || report.state === "amended"
    ? "signed"
    : report.state === "sent"
      ? "sent"
      : "editing";

export const isAmended = (report: Pick<CaseReport, "state">) => report.state === "amended";

const sizeText = (value: number | null) => (value === null ? "" : String(value));

const labelOf = (index: number) => `D${index + 1}`;

export function valuesOfParts(
  parts: CaseReportValues,
  staging: CaseReportStaging | null,
  previous?: Values,
): Values {
  const known = new Map(
    (previous?.deposits ?? []).flatMap((deposit) =>
      deposit.serverId ? [[deposit.serverId, deposit.id] as const] : [],
    ),
  );
  const taken = new Set(known.values());
  let counter = 0;
  const fresh = () => {
    while (taken.has(labelOf(counter))) counter += 1;
    const label = labelOf(counter);
    taken.add(label);
    return label;
  };
  return {
    specimen: parts.specimen ?? "",
    deposits: parts.deposits.map(
      (deposit): Dep => ({
        id: known.get(deposit.id) ?? fresh(),
        serverId: deposit.id,
        slide: deposit.slide_id,
        objectId: deposit.object_id,
        size: sizeText(deposit.size_mm),
        note: deposit.note ?? "",
        ...(deposit.size_mm === null && deposit.object_id !== null ? { unmeasured: true } : {}),
      }),
    ),
    category: parts.category === "none" ? null : parts.category,
    ack: Boolean(staging?.contradicts && staging.confirmed),
    examined: parts.nodes_examined === null ? "" : String(parts.nodes_examined),
    extranodal: parts.extranodal,
    diagnosis: parts.diagnosis ?? "",
    diagnosisAuto: previous?.diagnosisAuto ?? null,
    microscopic: parts.microscopic ?? "",
    comment: parts.comment ?? "",
  };
}

export const valuesOfCaseReport = (report: CaseReport, previous?: Values): Values =>
  valuesOfParts(report, report.staging, previous);

type TextKey = "specimen" | "diagnosis" | "microscopic" | "comment";

const textKeys: TextKey[] = ["specimen", "diagnosis", "microscopic", "comment"];

export function changeBetween(before: Values, after: Values): CaseReportChange {
  const change: CaseReportChange = {};
  for (const key of textKeys) {
    if (before[key].trim() !== after[key].trim()) change[key] = after[key].trim();
  }
  if (after.category !== null) {
    const confirmed = after.ack && (before.category !== after.category || !before.ack);
    if (before.category !== after.category || confirmed) change.category = after.category;
    if (confirmed) change.confirm_category = true;
  }
  if (before.examined.trim() !== after.examined.trim()) {
    const count = parseNumber(after.examined, true);
    if (count !== null && count <= 999) change.nodes_examined = count;
  }
  if (before.extranodal !== after.extranodal && after.extranodal !== null) {
    change.extranodal = after.extranodal;
  }
  return change;
}

export const isEmptyChange = (change: CaseReportChange) => Object.keys(change).length === 0;

export function newDepositOf(deposit: Omit<Dep, "id">): NewCaseReportDeposit {
  const size = depositMm(deposit);
  const note = deposit.note.trim();
  return {
    slide_id: deposit.slide,
    object_id: deposit.objectId,
    ...(size === null ? {} : { size_mm: size }),
    ...(note ? { note } : {}),
  };
}

type Placement = { step: StepKey; field: string; blockText: string };

const requiredFields: Record<string, Placement> = {
  specimen: { step: "findings", field: "specimen", blockText: "Specimen is empty" },
  diagnosis: { step: "text", field: "diag", blockText: "Final diagnosis is empty" },
  category: { step: "staging", field: "cat", blockText: "The category is not confirmed" },
  nodes_examined: { step: "staging", field: "exam", blockText: "Nodes examined is empty" },
  extranodal: {
    step: "staging",
    field: "ene",
    blockText: "Extranodal extension is not picked",
  },
};

export function issueOfBlocker(blocker: CaseReportBlocker): Issue {
  if (blocker.code === "deposit-without-size") {
    return {
      step: "staging",
      field: `deps.${blocker.deposit_id ?? ""}`,
      text: "Enter the size.",
      blockText: "A deposit has no size",
    };
  }
  if (blocker.code === "category-not-confirmed") {
    return {
      step: "staging",
      field: "ack",
      text: "Tick the box to keep this category, or pick the suggested one.",
      blockText: "The category does not match the size",
    };
  }
  const known = blocker.field ? requiredFields[blocker.field] : undefined;
  if (known) return { ...known, text: "Fill this in before you sign." };
  return {
    step: "text",
    field: blocker.field ?? "required",
    text: "Fill this in before you sign.",
    blockText: `${blocker.field ?? "A required field"} is empty`,
  };
}

export const issuesOfBlockers = (blockers: CaseReportBlocker[]): Issue[] =>
  blockers.map(issueOfBlocker);

const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const pad = (value: number) => String(value).padStart(2, "0");

export function stampOf(iso: string, withTime = true): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const day = `${at.getDate()} ${months[at.getMonth()] ?? ""}`;
  return withTime ? `${day} ${pad(at.getHours())}:${pad(at.getMinutes())}` : day;
}

const stepNames: Record<StepKey, string> = {
  findings: "Findings",
  staging: "Staging",
  text: "Report text",
  sign: "Sign out",
};

const nodeOf = (slide: CaseDetail["slides"][number], blocks: string[]) => {
  if (slide.block_id) return blocks.indexOf(slide.block_id) + 1;
  return Number(/\d+/.exec(slide.label)?.[0] ?? 1);
};

export type Assembly = {
  data: ReportData;
  values: Values;
  report: Report;
};

export type AssemblyInput = {
  project: Project;
  caseDetail: CaseDetail;
  server: CaseReport;
  userId: string;
  first: CaseReportVersion | null;
  previous?: Values | undefined;
};

const emptyReport = (values: Values): Report => ({
  values,
  mode: "sign",
  cosigner: null,
  removed: null,
  seen: ["findings"],
  touched: {},
  sent: null,
  signed: null,
  v1: null,
  amend: null,
  showV1: false,
  preview: false,
});

export function assembleReport(input: AssemblyInput): Assembly {
  const { project, caseDetail, server, userId, first } = input;
  const blocks = [
    ...new Set(caseDetail.slides.flatMap((slide) => (slide.block_id ? [slide.block_id] : []))),
  ];
  const slides = caseDetail.slides.map((slide) => ({
    key: slide.id,
    id: slide.id,
    label: `${slide.label} · ${slide.stain}`,
    node: nodeOf(slide, blocks),
    short: slide.stain === "H&E" ? slide.label : `${slide.label} ${slide.stain}`,
  }));
  const measured = new Map(
    server.findings.measurements.map((item) => [`${item.slide_id}:${item.object_id}`, item]),
  );
  const decided = server.findings.decisions.map((item) => ({
    slide: item.slide_id,
    object_id: item.object_id,
    size_mm: measured.get(`${item.slide_id}:${item.object_id}`)?.length_mm ?? 0,
    state: item.decision === "unsure" ? ("open" as const) : item.decision,
  }));
  const extras = server.findings.measurements
    .filter(
      (item) =>
        !decided.some(
          (candidate) =>
            candidate.slide === item.slide_id && candidate.object_id === item.object_id,
        ),
    )
    .map((item) => ({
      slide: item.slide_id,
      object_id: item.object_id,
      size_mm: item.length_mm ?? 0,
      state: "open" as const,
    }));
  const members = project.members.map((member) => ({
    user_id: member.user_id,
    role: member.role,
    sign_out: member.sign_out ?? ("never" as const),
    covers_case: server.signers.includes(member.user_id),
  }));
  const specimen = caseDetail.specimens[0];
  const values = valuesOfCaseReport(server, input.previous);
  const data: ReportData = {
    id: server.id,
    project: { id: project.id, code: project.code, name: project.name },
    case: {
      label: caseDetail.label,
      site: specimen?.site ?? server.specimen ?? caseDetail.label,
      clinical_history: "",
      received: specimen?.received_at ? stampOf(specimen.received_at, false) : "",
      requested_by: "",
      assigned_user_ids: [],
      examined: server.nodes_examined,
      cells: null,
    },
    template: {
      key: server.template.key,
      name: server.template.name,
      version: `v${server.template.version}`,
      steps: server.template.steps.map((step) => ({ key: step, label: stepNames[step] })),
      standards: server.template.key === "sentinel-node" ? nodeStandards : [],
    },
    slide: slides[0]?.short ?? "",
    slides,
    decisions: server.findings.decisions.map((item) => ({
      object_id: item.object_id,
      counts_as: item.decision,
      why: "",
    })),
    objects: [...decided, ...extras].map((item) => ({
      ...item,
      ai_size_mm: item.size_mm,
      measured_by: item.size_mm > 0 ? ("you" as const) : ("ai" as const),
    })),
    members,
    author_user_id: userId,
    values: {
      specimen: values.specimen,
      deposits: values.deposits.map((deposit) => ({
        id: deposit.id,
        slide: deposit.slide,
        object_id: deposit.objectId,
        size_mm: deposit.size,
        note: deposit.note,
      })),
      category: values.category,
      examined: values.examined,
      extranodal: values.extranodal,
      diagnosis: server.diagnosis,
      microscopic: values.microscopic,
      comment: values.comment,
    },
  };
  const filled = server.diagnosis?.trim() ? values : withDiagnosis(data, values);
  const report = emptyReport(filled);
  const phase = phaseOf(server);
  if (phase !== "editing") report.seen = stepKeys.filter((key) => hasKey(data, key));
  if (phase === "sent" && server.cosigner_user_id) {
    report.cosigner = server.cosigner_user_id;
    report.sent = {
      to: server.cosigner_user_id,
      at: server.sent_at ? stampOf(server.sent_at) : "",
      id: "",
    };
  }
  if (phase === "signed") {
    report.signed = signedOf(server, userId);
    report.v1 = first ? valuesOfParts(first.values, first.staging, filled) : filled;
    report.amend = amendOf(server);
  }
  return { data, values: filled, report };
}

export function signedOf(server: CaseReport, userId: string): Report["signed"] {
  const last: CaseReportSignature | undefined = server.versions[server.versions.length - 1];
  if (!last) return null;
  const reporter = last.reported_by_user_id;
  return {
    by: last.signed_by_user_id ?? userId,
    co: reporter,
    at: stampOf(server.versions[0]?.signed_at ?? last.signed_at),
  };
}

export function amendOf(server: CaseReport): Report["amend"] {
  const last: CaseReportSignature | undefined = server.versions[server.versions.length - 1];
  return isAmended(server) && last
    ? { why: last.reason ?? "", at: stampOf(last.signed_at, false) }
    : null;
}

const hasKey = (data: ReportData, key: StepKey) =>
  data.template.steps.some((step) => step.key === key);
