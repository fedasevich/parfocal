import type {
  CaseReport,
  CaseReportBlocker,
  CaseReportChange,
  NewCaseReportDeposit,
} from "@parfocal/api-client";
import type { Dep, Issue, StepKey, Values } from "./model.ts";
import { depositMm, parseNumber } from "./model.ts";

export type ReportPhase = "editing" | "sent" | "signed";

export const phaseOf = (report: Pick<CaseReport, "state">): ReportPhase =>
  report.state === "signed" || report.state === "amended"
    ? "signed"
    : report.state === "sent"
      ? "sent"
      : "editing";

export const isAmended = (report: Pick<CaseReport, "state">) => report.state === "amended";

const sizeText = (value: number | null) => (value === null ? "" : String(value));

export function valuesOfCaseReport(report: CaseReport, previous?: Values): Values {
  return {
    specimen: report.specimen ?? "",
    deposits: report.deposits.map(
      (deposit): Dep => ({
        id: deposit.id,
        slide: deposit.slide_id,
        objectId: deposit.object_id,
        size: sizeText(deposit.size_mm),
        note: deposit.note ?? "",
        ...(deposit.size_mm === null && deposit.object_id !== null ? { unmeasured: true } : {}),
      }),
    ),
    category: report.category === "none" ? null : report.category,
    ack: previous?.ack ?? report.staging?.confirmed ?? false,
    examined: report.nodes_examined === null ? "" : String(report.nodes_examined),
    extranodal: report.extranodal,
    diagnosis: report.diagnosis ?? "",
    diagnosisAuto: previous?.diagnosisAuto ?? null,
    microscopic: report.microscopic ?? "",
    comment: report.comment ?? "",
  };
}

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

const requiredFields: Record<string, { step: StepKey; field: string; blockText: string }> = {
  specimen: { step: "findings", field: "specimen", blockText: "Specimen is empty" },
  diagnosis: { step: "text", field: "diag", blockText: "Final diagnosis is empty" },
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
      blockText: "The category is not confirmed",
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
